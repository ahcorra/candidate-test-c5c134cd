from decimal import Decimal

from django.db import transaction
from django.db.models import DecimalField, F, Sum, Value
from django.db.models.functions import Round, TruncWeek
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Contract, TimesheetEntry
from .serializers import (
    ContractCreateSerializer,
    ContractSerializer,
    TimesheetEntrySerializer,
)

DEFAULT_PAGE_SIZE = 20
PAGE_SIZES = {20, 50, 100}


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


def _page_params(request):
    page_value = request.query_params.get('page')
    if page_value is None:
        page = 1
    else:
        page = _parse_query_int(page_value)
        if page is None or page < 1:
            return None, None, {'page': 'Must be a positive integer.'}

    size_value = request.query_params.get('page_size')
    if size_value is None:
        page_size = DEFAULT_PAGE_SIZE
    else:
        page_size = _parse_query_int(size_value)
        if page_size not in PAGE_SIZES:
            return None, None, {'page_size': 'Must be 20, 50, or 100.'}

    return page, page_size, None


def _filter_options(queryset):
    contracts = {}
    freelancers = {}
    option_rows = queryset.order_by().values_list(
        'contract_id',
        'contract__freelancer_id',
        'contract__freelancer__name',
        'contract__daily_rate',
        'contract__start_date',
        'contract__end_date',
    ).distinct()
    for contract_id, freelancer_id, freelancer_name, daily_rate, start_date, end_date in option_rows:
        contracts[contract_id] = f'{freelancer_name} · £{daily_rate}/day · {start_date:%b %Y}–{end_date:%b %Y}'
        freelancers[freelancer_id] = freelancer_name
    contract_options = [
        {'id': contract_id, 'name': name}
        for contract_id, name in sorted(contracts.items(), key=lambda option: option[1])
    ]
    freelancer_options = [
        {'id': freelancer_id, 'name': name}
        for freelancer_id, name in sorted(freelancers.items(), key=lambda option: option[1])
    ]
    return contract_options, freelancer_options


def _week_costs(queryset):
    # Each row is rounded to the penny before it is summed, so a week equals the rows shown for it.
    row_cost = Round(
        F('hours') * F('contract__daily_rate') / Value(Decimal('8')),
        precision=2,
        output_field=DecimalField(max_digits=14, decimal_places=2),
    )
    weeks = (
        queryset.order_by()
        .annotate(week_start=TruncWeek('date'))
        .values('week_start')
        .annotate(cost=Sum(row_cost))
        .order_by('week_start')
    )
    return [{'week_start': week['week_start'].isoformat(), 'cost': format(week['cost'], 'f')} for week in weeks]


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

        page, page_size, page_error = _page_params(request)
        if page_error is not None:
            return Response(page_error, status=status.HTTP_400_BAD_REQUEST)

        # Filter by status query param
        status_param = request.query_params.get('status')
        if status_param:
            valid_statuses = {choice for choice, _label in TimesheetEntry.STATUS_CHOICES}
            if status_param not in valid_statuses:
                return Response({'status': 'Invalid status.'}, status=status.HTTP_400_BAD_REQUEST)
            qs = qs.filter(status=status_param)

        # Dropdowns stay complete when the caller then narrows by person or date.
        option_qs = qs

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

        ordered = qs.order_by('date', 'id')
        total = ordered.count()
        start = (page - 1) * page_size
        # A page past the end is empty without asking the database for an offset it cannot hold.
        page_rows = ordered[start:start + page_size] if start < total else []
        contracts, freelancers = _filter_options(option_qs)
        return Response({
            'count': total,
            'page': page,
            'page_size': page_size,
            'results': TimesheetEntrySerializer(page_rows, many=True).data,
            'weeks': _week_costs(ordered),
            'contracts': contracts,
            'freelancers': freelancers,
        })

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

        # A rejection reason is only ever written by the admin who rejects the entry.
        entry = serializer.save(
            contract=contract,
            status=TimesheetEntry.STATUS_SUBMITTED,
            rejection_reason=None,
        )
        return Response(TimesheetEntrySerializer(entry).data, status=status.HTTP_201_CREATED)


class TimesheetDetailView(APIView):
    permission_classes = [IsAuthenticated]
    approval_fields = {'status', 'rejection_reason'}
    decisions = (TimesheetEntry.STATUS_APPROVED, TimesheetEntry.STATUS_REJECTED)

    def patch(self, request, pk):
        user = request.user

        if not hasattr(user, 'company_admin'):
            if hasattr(user, 'freelancer'):
                return Response(
                    {'detail': 'Only company admins can approve or reject timesheet entries.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        if not isinstance(request.data, dict):
            return Response({'detail': 'Expected a JSON object.'}, status=status.HTTP_400_BAD_REQUEST)

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
        if new_status not in self.decisions:
            return Response(
                {'status': 'Must be "approved" or "rejected".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            try:
                # Lock only the entry row, so decisions on one contract do not queue behind each other.
                entry = (
                    TimesheetEntry.objects.select_for_update(of=('self',))
                    .select_related('contract__freelancer')
                    .get(pk=pk, contract__company=user.company_admin.company)
                )
            except TimesheetEntry.DoesNotExist:
                return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

            # A user can be both a company admin and a freelancer. They still cannot decide their own hours.
            if entry.contract.freelancer.user_id == user.id:
                return Response(
                    {'detail': 'You cannot approve or reject your own hours.'},
                    status=status.HTTP_403_FORBIDDEN,
                )

            if entry.status != TimesheetEntry.STATUS_SUBMITTED:
                return Response(
                    {'status': 'Only a submitted entry can be approved or rejected.'},
                    status=status.HTTP_409_CONFLICT,
                )

            payload = {'status': new_status}
            if new_status == TimesheetEntry.STATUS_APPROVED:
                payload['rejection_reason'] = None
            else:
                payload['rejection_reason'] = request.data.get('rejection_reason')

            serializer = TimesheetEntrySerializer(entry, data=payload, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data)
