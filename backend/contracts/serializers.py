from rest_framework import serializers

from accounts.models import Freelancer
from accounts.serializers import CompanySerializer, FreelancerSerializer
from .models import Contract, TimesheetEntry


class ContractSerializer(serializers.ModelSerializer):
    company = CompanySerializer(read_only=True)
    freelancer = FreelancerSerializer(read_only=True)

    class Meta:
        model = Contract
        fields = ['id', 'company', 'freelancer', 'daily_rate', 'start_date', 'end_date', 'status']


class ContractCreateSerializer(serializers.ModelSerializer):
    """Write-only serialiser for manually creating a contract.

    The company is supplied by the view (the admin's own company), so it is
    not accepted from the client. Reads still go through ContractSerializer.
    """

    class Meta:
        model = Contract
        fields = ['freelancer', 'daily_rate', 'start_date', 'end_date', 'status']

    def validate(self, attrs):
        if attrs['end_date'] < attrs['start_date']:
            raise serializers.ValidationError(
                {'end_date': 'End date must be on or after the start date.'}
            )
        return attrs


class TimesheetFreelancerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Freelancer
        fields = ['id', 'name']


class TimesheetEntrySerializer(serializers.ModelSerializer):
    contract_id = serializers.IntegerField(read_only=True)  # redundant: 'contract' already exposes the FK id
    freelancer = TimesheetFreelancerSerializer(source='contract.freelancer', read_only=True)
    daily_rate = serializers.DecimalField(
        max_digits=8, decimal_places=2, read_only=True, source='contract.daily_rate'
    )

    class Meta:
        model = TimesheetEntry
        fields = [
            'id',
            'contract',
            'contract_id',
            'freelancer',
            'daily_rate',
            'date',
            'hours',
            'status',
            'rejection_reason',
        ]
        read_only_fields = ['id', 'contract_id']

    def validate(self, attrs):
        status = attrs.get('status', getattr(self.instance, 'status', None))
        if status != TimesheetEntry.STATUS_REJECTED:
            return attrs

        reason = attrs.get('rejection_reason')
        if reason is None and self.instance is not None:
            reason = self.instance.rejection_reason
        if reason is None or not str(reason).strip():
            raise serializers.ValidationError({
                'rejection_reason': 'This field is required when rejecting an entry.',
            })
        attrs['rejection_reason'] = str(reason).strip()
        return attrs
