from django.db import transaction
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Contract, TimesheetEntry


def _parse_query_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_query_date(value):
    try:
        return parse_date(value)
    except ValueError:
        return None
from .serializers import (
    ContractCreateSerializer,
    ContractSerializer,
    TimesheetEntrySerializer,
)


class ContractListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = self._get_queryset(request.user)
        return Response(ContractSerializer(qs, many=True).data)

    def post(self, request):
        # Manual contract creation — primarily a convenience for walking through
        # the app by hand. A company admin creates contracts for their own company;
        # the company is taken from the admin, never trusted from the request body.
        if not hasattr(request.user, 'company_admin'):
            return Response(
                {'detail': 'Only company admins can create contracts.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = ContractCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        contract = serializer.save(company=request.user.company_admin.company)
        return Response(ContractSerializer(contract).data, status=status.HTTP_201_CREATED)

    def _get_queryset(self, user):
        if hasattr(user, 'company_admin'):
            return Contract.objects.filter(
                company=user.company_admin.company
            ).select_related('company', 'freelancer')
        if hasattr(user, 'freelancer'):
            return Contract.objects.filter(
                freelancer=user.freelancer
            ).select_related('company', 'freelancer')
        return Contract.objects.none()


class ContractDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        # Fetch the contract and verify the current user should be able to see it.
        # Company admins see contracts belonging to their company; freelancers see their own.
        # Note: this permission check and the queryset construction are both inline here.
        # TODO: extract permission checking into a reusable mixin or policy object
        user = request.user

        if hasattr(user, 'company_admin'):
            try:
                contract = Contract.objects.select_related('company', 'freelancer').get(
                    pk=pk, company=user.company_admin.company
                )
            except Contract.DoesNotExist:
                return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        elif hasattr(user, 'freelancer'):
            try:
                contract = Contract.objects.select_related('company', 'freelancer').get(
                    pk=pk, freelancer=user.freelancer
                )
            except Contract.DoesNotExist:
                return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        else:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        return Response(ContractSerializer(contract).data)


class TimesheetListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        if hasattr(user, 'company_admin'):
            qs = TimesheetEntry.objects.filter(
                contract__company=user.company_admin.company
            )
        elif hasattr(user, 'freelancer'):
            qs = TimesheetEntry.objects.filter(
                contract__freelancer=user.freelancer
            )
        else:
            qs = TimesheetEntry.objects.none()

        qs = qs.select_related('contract__freelancer')

        # Filter by status query param
        status_param = request.query_params.get('status')
        if status_param:
            valid_statuses = {choice for choice, _label in TimesheetEntry.STATUS_CHOICES}
            if status_param not in valid_statuses:
                return Response({'status': 'Invalid status.'}, status=status.HTTP_400_BAD_REQUEST)
            qs = qs.filter(status=status_param)

        # Filter by contract id query param
        # TODO: move filter logic to a proper FilterSet class when we add django-filter
        contract_param = request.query_params.get('contract')
        if contract_param is not None:
            contract_id = _parse_query_int(contract_param)
            if contract_id is None:
                return Response({'contract': 'Must be an integer.'}, status=status.HTTP_400_BAD_REQUEST)
            qs = qs.filter(contract_id=contract_id)

        freelancer_param = request.query_params.get('freelancer')
        if freelancer_param is not None:
            freelancer_id = _parse_query_int(freelancer_param)
            if freelancer_id is None:
                return Response({'freelancer': 'Must be an integer.'}, status=status.HTTP_400_BAD_REQUEST)
            qs = qs.filter(contract__freelancer_id=freelancer_id)

        date_from_param = request.query_params.get('date_from')
        date_to_param = request.query_params.get('date_to')
        date_from = date_to = None
        if date_from_param is not None:
            date_from = _parse_query_date(date_from_param)
            if date_from is None:
                return Response(
                    {'date_from': 'Must be an ISO date (YYYY-MM-DD).'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            qs = qs.filter(date__gte=date_from)
        if date_to_param is not None:
            date_to = _parse_query_date(date_to_param)
            if date_to is None:
                return Response(
                    {'date_to': 'Must be an ISO date (YYYY-MM-DD).'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            qs = qs.filter(date__lte=date_to)
        if date_from is not None and date_to is not None and date_from > date_to:
            return Response(
                {'date_from': 'Must be on or before date_to.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(TimesheetEntrySerializer(qs, many=True).data)

    def post(self, request):
        if not hasattr(request.user, 'freelancer'):
            return Response(
                {'detail': 'Only freelancers can submit timesheet entries.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = TimesheetEntrySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        contract_id = request.data.get('contract')
        try:
            contract = Contract.objects.get(pk=contract_id, freelancer=request.user.freelancer)
        except Contract.DoesNotExist:
            return Response({'contract': 'Invalid contract.'}, status=status.HTTP_400_BAD_REQUEST)

        entry = serializer.save(contract=contract, status=TimesheetEntry.STATUS_SUBMITTED)
        return Response(TimesheetEntrySerializer(entry).data, status=status.HTTP_201_CREATED)


class TimesheetDetailView(APIView):
    permission_classes = [IsAuthenticated]
    approval_fields = {'status', 'rejection_reason'}

    def patch(self, request, pk):
        user = request.user

        if not hasattr(user, 'company_admin'):
            if hasattr(user, 'freelancer'):
                return Response(
                    {'detail': 'Only company admins can approve or reject timesheet entries.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        unexpected_fields = set(request.data.keys()) - self.approval_fields
        if unexpected_fields:
            return Response(
                {
                    'detail': (
                        'Only status and rejection_reason can be updated. '
                        f'Unexpected fields: {", ".join(sorted(unexpected_fields))}.'
                    ),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        new_status = request.data.get('status')
        with transaction.atomic():
            try:
                entry = (
                    TimesheetEntry.objects.select_for_update()
                    .get(pk=pk, contract__company=user.company_admin.company)
                )
            except TimesheetEntry.DoesNotExist:
                return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

            if (
                entry.status != TimesheetEntry.STATUS_SUBMITTED
                or new_status not in (
                    TimesheetEntry.STATUS_APPROVED,
                    TimesheetEntry.STATUS_REJECTED,
                )
            ):
                return Response(
                    {'status': 'Only a submitted entry can be approved or rejected.'},
                    status=status.HTTP_409_CONFLICT,
                )

            payload = {'status': new_status}
            if new_status == TimesheetEntry.STATUS_APPROVED:
                payload['rejection_reason'] = ''
            else:
                payload['rejection_reason'] = request.data.get('rejection_reason')

            serializer = TimesheetEntrySerializer(entry, data=payload, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data)
