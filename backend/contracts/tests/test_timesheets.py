import datetime
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from contracts.models import TimesheetEntry


def _results(response):
    return response.data['results']


@pytest.mark.django_db
def test_freelancer_can_submit_entry(freelancer_client, active_contract):
    resp = freelancer_client.post('/api/timesheets/', {
        'contract': active_contract.id,
        'date': '2026-05-01',
        'hours': '8.0',
    })
    assert resp.status_code == 201
    assert resp.data['status'] == 'submitted'
    assert resp.data['contract'] == active_contract.id


@pytest.mark.django_db
def test_admin_cannot_create_entry(admin_client, active_contract):
    resp = admin_client.post('/api/timesheets/', {
        'contract': active_contract.id,
        'date': '2026-05-01',
        'hours': '8.0',
    })
    assert resp.status_code == 403


@pytest.mark.django_db
def test_freelancer_cannot_submit_to_wrong_contract(freelancer_client):
    # Create a contract that belongs to a completely different freelancer
    from django.contrib.auth.models import User
    from accounts.models import Company, Freelancer
    from contracts.models import Contract
    other_user = User.objects.create_user(username='other@test.test', email='other@test.test', password='x')
    other_freelancer = Freelancer.objects.create(user=other_user, name='Other')
    company = Company.objects.create(name='Other Co', billing_email='other@co.test')
    unrelated_contract = Contract.objects.create(
        company=company,
        freelancer=other_freelancer,
        daily_rate=Decimal('500.00'),
        start_date=datetime.date(2026, 1, 1),
        end_date=datetime.date(2026, 12, 31),
        status='active',
    )
    resp = freelancer_client.post('/api/timesheets/', {
        'contract': unrelated_contract.id,
        'date': '2026-05-01',
        'hours': '8.0',
    })
    assert resp.status_code == 400


@pytest.mark.django_db
def test_timesheet_list_status_filter(admin_client, submitted_entry, active_contract):
    # Add an approved entry too
    TimesheetEntry.objects.create(
        contract=active_contract,
        date=datetime.date(2026, 3, 10),
        hours=Decimal('8.0'),
        status='approved',
    )
    resp = admin_client.get('/api/timesheets/?status=submitted')
    assert resp.status_code == 200
    assert all(row['status'] == 'submitted' for row in _results(resp))


@pytest.mark.django_db
def test_timesheet_list_contract_filter(admin_client, submitted_entry, active_contract):
    resp = admin_client.get(f'/api/timesheets/?contract={active_contract.id}')
    assert resp.status_code == 200
    assert all(row['contract'] == active_contract.id for row in _results(resp))


@pytest.mark.django_db
def test_patch_approve(admin_client, submitted_entry):
    resp = admin_client.patch(f'/api/timesheets/{submitted_entry.id}/', {'status': 'approved'})
    assert resp.status_code == 200
    assert resp.data['status'] == 'approved'


@pytest.mark.django_db
def test_patch_reject_requires_reason(admin_client, submitted_entry):
    resp = admin_client.patch(f'/api/timesheets/{submitted_entry.id}/', {'status': 'rejected'})
    assert resp.status_code == 400
    assert 'rejection_reason' in resp.data


@pytest.mark.django_db
def test_patch_reject_with_reason(admin_client, submitted_entry):
    resp = admin_client.patch(f'/api/timesheets/{submitted_entry.id}/', {
        'status': 'rejected',
        'rejection_reason': 'Hours do not match agreed scope.',
    })
    assert resp.status_code == 200
    assert resp.data['status'] == 'rejected'
    assert resp.data['rejection_reason'] == 'Hours do not match agreed scope.'


@pytest.mark.django_db
def test_admin_cannot_see_other_company_timesheet(admin_client, other_contract):
    entry = TimesheetEntry.objects.create(
        contract=other_contract,
        date=datetime.date(2026, 4, 1),
        hours=Decimal('8.0'),
        status='submitted',
    )
    resp = admin_client.patch(f'/api/timesheets/{entry.id}/', {'status': 'approved'})
    assert resp.status_code == 404


@pytest.mark.django_db
def test_timesheet_list_requires_auth(api_client):
    resp = api_client.get('/api/timesheets/')
    assert resp.status_code == 401


@pytest.mark.django_db
def test_freelancer_can_list_own_timesheets(freelancer_client, submitted_entry):
    resp = freelancer_client.get('/api/timesheets/')
    assert resp.status_code == 200
    assert len(_results(resp)) == 1
    assert _results(resp)[0]['id'] == submitted_entry.id


@pytest.mark.django_db
def test_admin_can_list_company_timesheets(admin_client, submitted_entry):
    resp = admin_client.get('/api/timesheets/')
    assert resp.status_code == 200
    assert any(row['id'] == submitted_entry.id for row in _results(resp))


@pytest.mark.django_db
def test_admin_list_excludes_other_company_entries(admin_client, other_contract):
    other_entry = TimesheetEntry.objects.create(
        contract=other_contract,
        date=datetime.date(2026, 4, 2),
        hours=Decimal('8.0'),
        status='submitted',
    )
    resp = admin_client.get('/api/timesheets/')
    assert resp.status_code == 200
    assert all(row['id'] != other_entry.id for row in _results(resp))


@pytest.mark.django_db
def test_duplicate_contract_date_rejected(freelancer_client, submitted_entry, active_contract):
    resp = freelancer_client.post('/api/timesheets/', {
        'contract': active_contract.id,
        'date': submitted_entry.date.isoformat(),
        'hours': '7.5',
    })
    assert resp.status_code == 400


@pytest.mark.django_db
def test_patch_nonexistent_entry_returns_404(admin_client):
    resp = admin_client.patch('/api/timesheets/99999/', {'status': 'approved'})
    assert resp.status_code == 404


@pytest.mark.django_db
def test_timesheet_response_shape(freelancer_client, active_contract):
    resp = freelancer_client.post('/api/timesheets/', {
        'contract': active_contract.id,
        'date': '2026-05-02',
        'hours': '7.5',
    })
    assert resp.status_code == 201
    data = resp.data
    assert set(data.keys()) >= {'id', 'contract', 'contract_id', 'date', 'hours', 'status', 'rejection_reason'}
    assert data['contract'] == active_contract.id
    assert data['contract_id'] == active_contract.id
    assert data['status'] == 'submitted'
    assert data['rejection_reason'] is None


@pytest.mark.django_db
def test_status_filter_returns_empty_list(admin_client, submitted_entry):
    resp = admin_client.get('/api/timesheets/?status=approved')
    assert resp.status_code == 200
    assert _results(resp) == []
    assert resp.data['count'] == 0


@pytest.mark.django_db
def test_reject_with_empty_reason_string_returns_400(admin_client, submitted_entry):
    resp = admin_client.patch(f'/api/timesheets/{submitted_entry.id}/', {
        'status': 'rejected',
        'rejection_reason': '',
    })
    assert resp.status_code == 400
    assert 'rejection_reason' in resp.data


@pytest.mark.django_db
def test_reject_with_whitespace_reason_returns_400(admin_client, submitted_entry):
    resp = admin_client.patch(f'/api/timesheets/{submitted_entry.id}/', {
        'status': 'rejected',
        'rejection_reason': '   ',
    })
    assert resp.status_code == 400
    assert 'rejection_reason' in resp.data
    submitted_entry.refresh_from_db()
    assert submitted_entry.status == 'submitted'


@pytest.mark.django_db
def test_reject_strips_reason(admin_client, submitted_entry):
    resp = admin_client.patch(f'/api/timesheets/{submitted_entry.id}/', {
        'status': 'rejected',
        'rejection_reason': '  Hours do not match.  ',
    })
    assert resp.status_code == 200
    assert resp.data['rejection_reason'] == 'Hours do not match.'


@pytest.mark.django_db
def test_approve_clears_rejection_reason(admin_client, submitted_entry):
    submitted_entry.rejection_reason = 'Earlier note'
    submitted_entry.save(update_fields=['rejection_reason'])
    resp = admin_client.patch(f'/api/timesheets/{submitted_entry.id}/', {'status': 'approved'})
    assert resp.status_code == 200
    assert resp.data['rejection_reason'] is None
    submitted_entry.refresh_from_db()
    assert submitted_entry.rejection_reason is None
    assert submitted_entry.status == 'approved'


@pytest.mark.django_db
def test_freelancer_cannot_approve_own_entry(freelancer_client, submitted_entry):
    resp = freelancer_client.patch(f'/api/timesheets/{submitted_entry.id}/', {'status': 'approved'})
    assert resp.status_code == 403
    submitted_entry.refresh_from_db()
    assert submitted_entry.status == 'submitted'


@pytest.mark.django_db
def test_freelancer_cannot_change_hours(freelancer_client, submitted_entry):
    resp = freelancer_client.patch(f'/api/timesheets/{submitted_entry.id}/', {'hours': '1.0'})
    assert resp.status_code == 403
    submitted_entry.refresh_from_db()
    assert submitted_entry.hours == Decimal('8.0')


@pytest.mark.django_db
def test_admin_cannot_change_hours_or_contract_when_approving(admin_client, submitted_entry, active_contract):
    resp = admin_client.patch(f'/api/timesheets/{submitted_entry.id}/', {
        'status': 'approved',
        'hours': '1.0',
        'contract': active_contract.id,
    })
    assert resp.status_code == 400
    submitted_entry.refresh_from_db()
    assert submitted_entry.status == 'submitted'
    assert submitted_entry.hours == Decimal('8.0')


@pytest.mark.django_db
def test_timesheet_list_rejects_invalid_filters(admin_client, submitted_entry):
    assert admin_client.get('/api/timesheets/?contract=abc').status_code == 400
    assert admin_client.get('/api/timesheets/?status=nope').status_code == 400
    assert admin_client.get('/api/timesheets/?freelancer=no').status_code == 400
    assert admin_client.get('/api/timesheets/?date_from=2026-13-01').status_code == 400
    reversed_range = admin_client.get('/api/timesheets/?date_from=2026-05-02&date_to=2026-05-01')
    assert reversed_range.status_code == 400


@pytest.mark.django_db
def test_timesheet_list_filters_by_freelancer_and_date(admin_client, submitted_entry, active_contract, northstar):
    from django.contrib.auth.models import User
    from accounts.models import Freelancer
    from contracts.models import Contract
    other_user = User.objects.create_user(username='sam@test.test', email='sam@test.test', password='x')
    other_freelancer = Freelancer.objects.create(user=other_user, name='Sam Chen')
    other_contract = Contract.objects.create(
        company=northstar,
        freelancer=other_freelancer,
        daily_rate=Decimal('500.00'),
        start_date=datetime.date(2026, 1, 1),
        end_date=datetime.date(2026, 12, 31),
        status='active',
    )
    other_entry = TimesheetEntry.objects.create(
        contract=other_contract,
        date=datetime.date(2026, 4, 8),
        hours=Decimal('8.0'),
        status='submitted',
    )

    by_freelancer = admin_client.get(f'/api/timesheets/?freelancer={active_contract.freelancer_id}')
    assert by_freelancer.status_code == 200
    assert {row['id'] for row in _results(by_freelancer)} == {submitted_entry.id}

    by_date = admin_client.get('/api/timesheets/?date_from=2026-04-08&date_to=2026-04-08')
    assert by_date.status_code == 200
    assert {row['id'] for row in _results(by_date)} == {other_entry.id}


@pytest.mark.django_db
def test_timesheet_list_filters_do_not_cross_companies(admin_client, other_contract):
    TimesheetEntry.objects.create(
        contract=other_contract,
        date=datetime.date(2026, 4, 3),
        hours=Decimal('8.0'),
        status='submitted',
    )
    resp = admin_client.get(
        f'/api/timesheets/?freelancer={other_contract.freelancer_id}&date_from=2026-04-01&date_to=2026-04-30'
    )
    assert resp.status_code == 200
    assert _results(resp) == []
    assert resp.data['count'] == 0


@pytest.mark.django_db
def test_timesheet_list_includes_freelancer_and_rate(admin_client, submitted_entry, active_contract):
    resp = admin_client.get('/api/timesheets/')
    assert resp.status_code == 200
    row = next(item for item in _results(resp) if item['id'] == submitted_entry.id)
    assert row['contract'] == active_contract.id
    assert row['contract_id'] == active_contract.id
    assert row['daily_rate'] == '600.00'
    assert row['freelancer'] == {
        'id': active_contract.freelancer_id,
        'name': active_contract.freelancer.name,
    }


@pytest.mark.django_db
def test_cannot_approve_entry_that_is_not_submitted(admin_client, active_contract):
    approved = TimesheetEntry.objects.create(
        contract=active_contract,
        date=datetime.date(2026, 4, 8),
        hours=Decimal('8.0'),
        status='approved',
    )
    draft = TimesheetEntry.objects.create(
        contract=active_contract,
        date=datetime.date(2026, 4, 9),
        hours=Decimal('8.0'),
        status='draft',
    )
    approved_resp = admin_client.patch(f'/api/timesheets/{approved.id}/', {'status': 'approved'})
    draft_resp = admin_client.patch(f'/api/timesheets/{draft.id}/', {'status': 'rejected', 'rejection_reason': 'No'})
    assert approved_resp.status_code == 409
    assert draft_resp.status_code == 409
    draft.refresh_from_db()
    assert draft.status == 'draft'


@pytest.mark.django_db
def test_timesheet_list_pages_oldest_first(admin_client, active_contract):
    first_day = datetime.date(2026, 7, 6)
    for offset in range(21):
        TimesheetEntry.objects.create(
            contract=active_contract,
            date=first_day + datetime.timedelta(days=offset),
            hours=Decimal('8.0'),
            status='submitted',
        )

    first_page = admin_client.get('/api/timesheets/?status=submitted')
    assert first_page.status_code == 200
    assert first_page.data['count'] == 21
    assert first_page.data['page'] == 1
    assert first_page.data['page_size'] == 20
    assert len(_results(first_page)) == 20
    assert _results(first_page)[0]['date'] == '2026-07-06'

    second_page = admin_client.get('/api/timesheets/?status=submitted&page=2')
    assert len(_results(second_page)) == 1
    assert _results(second_page)[0]['date'] == '2026-07-26'

    week_total = sum(Decimal(week['cost']) for week in first_page.data['weeks'])
    assert week_total == Decimal('12600.00')


@pytest.mark.django_db
def test_timesheet_list_accepts_page_sizes(admin_client, active_contract):
    TimesheetEntry.objects.create(
        contract=active_contract,
        date=datetime.date(2026, 8, 3),
        hours=Decimal('8.0'),
        status='submitted',
    )
    page_of_fifty = admin_client.get('/api/timesheets/?page_size=50')
    page_of_hundred = admin_client.get('/api/timesheets/?page_size=100')
    assert page_of_fifty.data['page_size'] == 50
    assert page_of_hundred.data['page_size'] == 100
    assert admin_client.get('/api/timesheets/?page_size=10').status_code == 400
    assert admin_client.get('/api/timesheets/?page=0').status_code == 400
    assert admin_client.get('/api/timesheets/?page=abc').status_code == 400


@pytest.mark.django_db
def test_admin_who_is_also_the_freelancer_cannot_decide_own_hours(admin_client, admin_user, northstar):
    from accounts.models import Freelancer
    from contracts.models import Contract
    own_profile = Freelancer.objects.create(user=admin_user, name='Admin Freelancing')
    own_contract = Contract.objects.create(
        company=northstar,
        freelancer=own_profile,
        daily_rate=Decimal('600.00'),
        start_date=datetime.date(2026, 1, 1),
        end_date=datetime.date(2026, 12, 31),
        status='active',
    )
    own_entry = TimesheetEntry.objects.create(
        contract=own_contract,
        date=datetime.date(2026, 4, 7),
        hours=Decimal('8.0'),
        status='submitted',
    )
    resp = admin_client.patch(f'/api/timesheets/{own_entry.id}/', {'status': 'approved'})
    assert resp.status_code == 403
    own_entry.refresh_from_db()
    assert own_entry.status == 'submitted'


@pytest.mark.django_db
def test_reject_needs_a_reason_in_the_request(admin_client, submitted_entry):
    submitted_entry.rejection_reason = 'Stored earlier'
    submitted_entry.save(update_fields=['rejection_reason'])
    resp = admin_client.patch(f'/api/timesheets/{submitted_entry.id}/', {'status': 'rejected'})
    assert resp.status_code == 400
    assert 'rejection_reason' in resp.data
    submitted_entry.refresh_from_db()
    assert submitted_entry.status == 'submitted'


@pytest.mark.django_db
def test_reject_reason_needs_visible_text_and_a_sane_length(admin_client, submitted_entry):
    url = f'/api/timesheets/{submitted_entry.id}/'
    invisible = admin_client.patch(url, {'status': 'rejected', 'rejection_reason': '​'}, format='json')
    too_long = admin_client.patch(url, {'status': 'rejected', 'rejection_reason': 'x' * 1001}, format='json')
    assert invisible.status_code == 400
    assert too_long.status_code == 400


@pytest.mark.django_db
def test_create_ignores_a_rejection_reason(freelancer_client, active_contract):
    resp = freelancer_client.post('/api/timesheets/', {
        'contract': active_contract.id,
        'date': '2026-05-04',
        'hours': '8.0',
        'rejection_reason': 'Pre-approved by finance',
    })
    assert resp.status_code == 201
    assert resp.data['rejection_reason'] is None


@pytest.mark.django_db
def test_patch_rejects_a_body_that_is_not_a_decision(admin_client, submitted_entry):
    url = f'/api/timesheets/{submitted_entry.id}/'
    assert admin_client.patch(url, [], format='json').status_code == 400
    assert admin_client.patch(url, 'approved', format='json').status_code == 400
    assert admin_client.patch(url, {'status': 'draft'}, format='json').status_code == 400
    assert admin_client.patch(url, {}, format='json').status_code == 400
    submitted_entry.refresh_from_db()
    assert submitted_entry.status == 'submitted'


@pytest.mark.django_db
def test_timesheet_list_page_past_the_end_is_empty(admin_client, submitted_entry):
    resp = admin_client.get('/api/timesheets/?status=submitted&page=1000000000000000000')
    assert resp.status_code == 200
    assert resp.data['results'] == []
    assert resp.data['count'] == 1


@pytest.mark.django_db
def test_approval_locks_only_the_entry_row(admin_client, submitted_entry):
    with CaptureQueriesContext(connection) as queries:
        resp = admin_client.patch(f'/api/timesheets/{submitted_entry.id}/', {'status': 'approved'})
    assert resp.status_code == 200
    locking = [query['sql'] for query in queries.captured_queries if 'FOR UPDATE' in query['sql']]
    assert len(locking) == 1
    assert 'FOR UPDATE OF "contracts_timesheetentry"' in locking[0]
