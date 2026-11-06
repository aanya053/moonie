from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.models.task import Task, TaskDependency
from app.services.recurrence_service import RecurrenceService
from app.services.task_service import TaskService
from app.schemas.brain_dump import ProposedTask
from app.services.brain_dump_service import ProviderFailure


API_PREFIX = "/api/v1"


async def create_task(client: AsyncClient, title: str, **fields) -> dict:
    response = await client.post(f"{API_PREFIX}/tasks", json={"title": title, **fields})
    assert response.status_code == 201, response.text
    return response.json()


async def create_rule(client: AsyncClient, title: str = "Daily study") -> dict:
    response = await client.post(
        f"{API_PREFIX}/recurring-rules",
        json={
            "title": title,
            "frequency": "daily",
            "interval_val": 1,
            "time_of_day": "09:00",
            "start_at": "2030-01-01T10:00:00Z",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.asyncio
async def test_health_endpoint(client: AsyncClient):
    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "Moonie Task Engine",
        "version": "0.1.0",
    }


@pytest.mark.asyncio
async def test_brain_dump_requires_configured_provider_without_creating_tasks(client: AsyncClient, monkeypatch):
    monkeypatch.delenv("MOONIE_LLM_PROVIDER", raising=False)
    monkeypatch.delenv("MOONIE_LLM_API_KEY", raising=False)
    response = await client.post(f"{API_PREFIX}/brain-dump/parse", json={"text": "Finish the report"})
    assert response.status_code == 503
    assert "unavailable" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_brain_dump_validates_mocked_provider_output(client: AsyncClient, monkeypatch):
    class FakeProvider:
        async def extract(self, text, now, timezone_name):
            assert text == "Finish the report"
            return [ProposedTask(title="Finish the report", task_type="deadline")]

    monkeypatch.setattr("app.services.brain_dump_service.configured_provider", lambda: FakeProvider())
    response = await client.post(f"{API_PREFIX}/brain-dump/parse", json={"text": "Finish the report"})
    assert response.status_code == 200
    assert response.json()["proposals"][0]["title"] == "Finish the report"


@pytest.mark.asyncio
async def test_brain_dump_provider_failure_is_not_reported_as_success(client: AsyncClient, monkeypatch):
    class FailingProvider:
        async def extract(self, text, now, timezone_name):
            raise ProviderFailure("provider timed out")

    monkeypatch.setattr("app.services.brain_dump_service.configured_provider", lambda: FailingProvider())
    response = await client.post(f"{API_PREFIX}/brain-dump/parse", json={"text": "Finish the report"})
    assert response.status_code == 502
    assert response.json()["detail"] == "provider timed out"


@pytest.mark.asyncio
async def test_task_create_retrieve_update_list_filters_and_delete(client: AsyncClient):
    task = await create_task(
        client,
        "Submit assignment",
        task_type="deadline",
        due_at="2030-01-02T10:00:00Z",
    )

    retrieved = await client.get(f"{API_PREFIX}/tasks/{task['id']}")
    assert retrieved.status_code == 200
    assert retrieved.json()["title"] == "Submit assignment"
    assert retrieved.json()["task_type"] == "deadline"

    updated = await client.patch(
        f"{API_PREFIX}/tasks/{task['id']}",
        json={"title": "Submit revised assignment", "notes": "Upload PDF"},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Submit revised assignment"
    assert updated.json()["notes"] == "Upload PDF"

    filtered = await client.get(
        f"{API_PREFIX}/tasks",
        params={"status": "pending", "task_type": "deadline"},
    )
    assert filtered.status_code == 200
    assert [item["id"] for item in filtered.json()] == [task["id"]]

    deleted = await client.delete(f"{API_PREFIX}/tasks/{task['id']}")
    assert deleted.status_code == 204
    assert (await client.get(f"{API_PREFIX}/tasks/{task['id']}")).status_code == 404


@pytest.mark.asyncio
async def test_task_lifecycle_actions_persist_expected_state(client: AsyncClient):
    task = await create_task(client, "Lifecycle task")

    started = await client.post(f"{API_PREFIX}/tasks/{task['id']}/start")
    assert started.status_code == 200
    assert started.json()["status"] == "in_progress"

    completed = await client.post(f"{API_PREFIX}/tasks/{task['id']}/complete")
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    assert completed.json()["completed_at"] is not None

    reopened = await client.post(f"{API_PREFIX}/tasks/{task['id']}/reopen")
    assert reopened.status_code == 200
    assert reopened.json()["status"] == "pending"
    assert reopened.json()["completed_at"] is None

    dropped = await client.post(f"{API_PREFIX}/tasks/{task['id']}/drop")
    assert dropped.status_code == 200
    assert dropped.json()["status"] == "dropped"
    assert dropped.json()["dropped_at"] is not None


@pytest.mark.asyncio
async def test_snooze_persists_custom_time_and_requires_custom_timestamp(client: AsyncClient):
    task = await create_task(client, "Snoozable task")

    missing_custom_time = await client.post(
        f"{API_PREFIX}/tasks/{task['id']}/snooze",
        json={"preset": "custom"},
    )
    assert missing_custom_time.status_code == 400

    snoozed = await client.post(
        f"{API_PREFIX}/tasks/{task['id']}/snooze",
        json={"preset": "custom", "custom_until": "2030-01-03T09:00:00Z"},
    )
    assert snoozed.status_code == 200
    assert snoozed.json()["status"] == "snoozed"
    assert snoozed.json()["snooze_count"] == 1
    assert snoozed.json()["snoozed_until"].startswith("2030-01-03T09:00:00")


@pytest.mark.asyncio
async def test_invalid_ids_and_malformed_requests_return_errors(client: AsyncClient):
    assert (await client.get(f"{API_PREFIX}/tasks/not-found")).status_code == 404
    assert (
        await client.post(f"{API_PREFIX}/tasks", json={"title": ""})
    ).status_code == 422
    assert (
        await client.post(
            f"{API_PREFIX}/tasks",
            json={"title": "Bad type", "task_type": "unknown"},
        )
    ).status_code == 422
    assert (
        await client.patch(
            f"{API_PREFIX}/tasks/not-found", json={"title": "Still missing"}
        )
    ).status_code == 404


@pytest.mark.asyncio
async def test_dependencies_block_until_prerequisite_is_completed_and_can_be_removed(
    client: AsyncClient,
):
    prerequisite = await create_task(client, "Read chapter")
    dependent = await create_task(
        client,
        "Write summary",
        depends_on_task_ids=[prerequisite["id"]],
    )
    assert dependent["is_blocked"] is True
    assert dependent["prerequisite_ids"] == [prerequisite["id"]]

    blocked_start = await client.post(f"{API_PREFIX}/tasks/{dependent['id']}/start")
    assert blocked_start.status_code == 400

    completed = await client.post(f"{API_PREFIX}/tasks/{prerequisite['id']}/complete")
    assert completed.status_code == 200
    unblocked_start = await client.post(f"{API_PREFIX}/tasks/{dependent['id']}/start")
    assert unblocked_start.status_code == 200

    removed = await client.delete(
        f"{API_PREFIX}/tasks/{dependent['id']}/dependencies/{prerequisite['id']}"
    )
    assert removed.status_code == 204
    refreshed = await client.get(f"{API_PREFIX}/tasks/{dependent['id']}")
    assert refreshed.status_code == 200
    assert refreshed.json()["prerequisite_ids"] == []


@pytest.mark.asyncio
async def test_successful_multi_dependency_creation_persists_all_dependencies(
    client: AsyncClient,
):
    first = await create_task(client, "First prerequisite")
    second = await create_task(client, "Second prerequisite")

    dependent = await create_task(
        client,
        "Task with two prerequisites",
        depends_on_task_ids=[first["id"], second["id"]],
    )

    assert dependent["is_blocked"] is True
    assert set(dependent["prerequisite_ids"]) == {first["id"], second["id"]}


@pytest.mark.asyncio
async def test_dropped_prerequisite_is_treated_as_satisfied(client: AsyncClient):
    prerequisite = await create_task(client, "Drop prerequisite")
    dependent = await create_task(
        client,
        "Continue after drop",
        depends_on_task_ids=[prerequisite["id"]],
    )

    dropped = await client.post(f"{API_PREFIX}/tasks/{prerequisite['id']}/drop")
    assert dropped.status_code == 200
    start = await client.post(f"{API_PREFIX}/tasks/{dependent['id']}/start")
    assert start.status_code == 200


@pytest.mark.asyncio
async def test_dependency_cycle_is_rejected(client: AsyncClient):
    first = await create_task(client, "First")
    second = await create_task(client, "Second")

    initial = await client.post(
        f"{API_PREFIX}/tasks/{first['id']}/dependencies",
        json={"depends_on_task_id": second["id"]},
    )
    assert initial.status_code == 201

    cycle = await client.post(
        f"{API_PREFIX}/tasks/{second['id']}/dependencies",
        json={"depends_on_task_id": first["id"]},
    )
    assert cycle.status_code == 400
    assert "circular" in cycle.json()["detail"].lower()


@pytest.mark.asyncio
async def test_multi_dependency_creation_rolls_back_task_and_dependencies(
    client: AsyncClient,
    test_engine: AsyncEngine,
):
    valid_prerequisite = await create_task(client, "Valid prerequisite")

    response = await client.post(
        f"{API_PREFIX}/tasks",
        json={
            "title": "Partially committed task",
            "depends_on_task_ids": [valid_prerequisite["id"], "missing-id"],
        },
    )
    assert response.status_code == 404

    tasks = await client.get(f"{API_PREFIX}/tasks", params={"include_completed": True})
    assert tasks.status_code == 200
    partial = [item for item in tasks.json() if item["title"] == "Partially committed task"]
    assert partial == []

    async with AsyncSession(test_engine) as session:
        persisted_task = await session.scalar(
            select(Task).where(Task.title == "Partially committed task")
        )
        persisted_dependencies = (
            await session.scalars(
                select(TaskDependency).where(
                    TaskDependency.depends_on_task_id == valid_prerequisite["id"]
                )
            )
        ).all()
        assert persisted_task is None
        assert persisted_dependencies == []


@pytest.mark.asyncio
async def test_completed_task_cannot_be_snoozed_and_state_is_unchanged(
    client: AsyncClient,
):
    completed = await create_task(client, "Completed task")
    assert (await client.post(f"{API_PREFIX}/tasks/{completed['id']}/complete")).status_code == 200
    completed_snoozed = await client.post(
        f"{API_PREFIX}/tasks/{completed['id']}/snooze",
        json={"preset": "tomorrow_morning"},
    )
    assert completed_snoozed.status_code == 400
    assert "completed" in completed_snoozed.json()["detail"].lower()
    persisted = await client.get(f"{API_PREFIX}/tasks/{completed['id']}")
    assert persisted.status_code == 200
    assert persisted.json()["status"] == "completed"


@pytest.mark.asyncio
async def test_dropped_task_cannot_be_started_and_state_is_unchanged(
    client: AsyncClient,
):
    dropped = await create_task(client, "Dropped task")
    assert (await client.post(f"{API_PREFIX}/tasks/{dropped['id']}/drop")).status_code == 200

    dropped_started = await client.post(f"{API_PREFIX}/tasks/{dropped['id']}/start")
    assert dropped_started.status_code == 400
    assert "dropped" in dropped_started.json()["detail"].lower()
    persisted = await client.get(f"{API_PREFIX}/tasks/{dropped['id']}")
    assert persisted.status_code == 200
    assert persisted.json()["status"] == "dropped"


@pytest.mark.asyncio
async def test_snooze_eligibility_excludes_future_and_releases_past_tasks(
    client: AsyncClient,
    test_engine: AsyncEngine,
):
    future_task = await create_task(client, "Future snooze")
    past_task = await create_task(client, "Past snooze")
    assert (
        await client.post(
            f"{API_PREFIX}/tasks/{future_task['id']}/snooze",
            json={"preset": "custom", "custom_until": "2099-01-01T09:00:00Z"},
        )
    ).status_code == 200
    assert (
        await client.post(
            f"{API_PREFIX}/tasks/{past_task['id']}/snooze",
            json={"preset": "custom", "custom_until": "2020-01-01T09:00:00Z"},
        )
    ).status_code == 200

    async with AsyncSession(test_engine) as session:
        eligible = await TaskService.list_tasks(
            session,
            now=datetime(2030, 1, 1, tzinfo=timezone.utc),
        )
        eligible_ids = {task.id for task in eligible}
        assert future_task["id"] not in eligible_ids
        assert past_task["id"] in eligible_ids

    management_view = await client.get(
        f"{API_PREFIX}/tasks", params={"status": "snoozed"}
    )
    assert management_view.status_code == 200
    assert {item["id"] for item in management_view.json()} == {
        future_task["id"],
        past_task["id"],
    }


@pytest.mark.asyncio
async def test_recurring_rule_crud_and_initial_instance(client: AsyncClient):
    rule = await create_rule(client)
    assert rule["frequency"] == "daily"
    assert rule["next_trigger_at"].startswith("2030-01-03T09:00:00")

    rules = await client.get(f"{API_PREFIX}/recurring-rules")
    assert rules.status_code == 200
    assert [item["id"] for item in rules.json()] == [rule["id"]]

    fetched = await client.get(f"{API_PREFIX}/recurring-rules/{rule['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["title"] == "Daily study"

    instances = await client.get(
        f"{API_PREFIX}/tasks", params={"task_type": "recurring"}
    )
    assert instances.status_code == 200
    assert len(instances.json()) == 1
    assert instances.json()[0]["scheduled_at"].startswith("2030-01-02T09:00:00")

    updated = await client.patch(
        f"{API_PREFIX}/recurring-rules/{rule['id']}",
        json={"title": "Daily revised", "time_of_day": "10:00"},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Daily revised"

    deleted = await client.delete(f"{API_PREFIX}/recurring-rules/{rule['id']}")
    assert deleted.status_code == 204
    assert (await client.get(f"{API_PREFIX}/recurring-rules/{rule['id']}")).status_code == 404


@pytest.mark.asyncio
async def test_deleting_recurring_rule_preserves_and_detaches_linked_instances(
    client: AsyncClient,
):
    rule = await create_rule(client, "Delete rule")
    instances = await client.get(f"{API_PREFIX}/tasks", params={"task_type": "recurring"})
    original = instances.json()[0]
    updated = await client.patch(
        f"{API_PREFIX}/tasks/{original['id']}",
        json={"notes": "Historical instance"},
    )
    assert updated.status_code == 200

    deleted = await client.delete(f"{API_PREFIX}/recurring-rules/{rule['id']}")
    assert deleted.status_code == 204
    preserved = await client.get(f"{API_PREFIX}/tasks/{original['id']}")
    assert preserved.status_code == 200
    assert preserved.json()["recurring_rule_id"] is None
    assert preserved.json()["title"] == original["title"]
    assert preserved.json()["notes"] == "Historical instance"
    assert preserved.json()["status"] == original["status"]


@pytest.mark.asyncio
async def test_recurring_task_resolution_spawns_next_instance(client: AsyncClient):
    rule = await create_rule(client, "Resolve daily")
    instances = await client.get(f"{API_PREFIX}/tasks", params={"task_type": "recurring"})
    first = instances.json()[0]

    completed = await client.post(f"{API_PREFIX}/tasks/{first['id']}/complete")
    assert completed.status_code == 200

    after_resolution = await client.get(
        f"{API_PREFIX}/tasks", params={"task_type": "recurring"}
    )
    assert after_resolution.status_code == 200
    assert len(after_resolution.json()) == 1
    assert after_resolution.json()[0]["status"] == "pending"
    assert after_resolution.json()[0]["recurring_rule_id"] == rule["id"]


@pytest.mark.asyncio
async def test_monthly_rule_keeps_anchor_through_repeated_spawning(client: AsyncClient):
    response = await client.post(
        f"{API_PREFIX}/recurring-rules",
        json={
            "title": "Month-end review",
            "frequency": "monthly",
            "start_at": "2030-01-31T09:00:00Z",
            "time_of_day": "09:00",
        },
    )
    assert response.status_code == 201
    assert response.json()["next_trigger_at"].startswith("2030-03-31T09:00:00")

    first_response = await client.get(
        f"{API_PREFIX}/tasks", params={"task_type": "recurring"}
    )
    first = first_response.json()[0]
    assert first["scheduled_at"].startswith("2030-02-28T09:00:00")

    assert (await client.post(f"{API_PREFIX}/tasks/{first['id']}/complete")).status_code == 200
    second_response = await client.get(
        f"{API_PREFIX}/tasks", params={"task_type": "recurring"}
    )
    second = second_response.json()[0]
    assert second["scheduled_at"].startswith("2030-03-31T09:00:00")

    assert (await client.post(f"{API_PREFIX}/tasks/{second['id']}/complete")).status_code == 200
    third_response = await client.get(
        f"{API_PREFIX}/tasks", params={"task_type": "recurring"}
    )
    third = third_response.json()[0]
    assert third["scheduled_at"].startswith("2030-04-30T09:00:00")


def test_recurrence_calculations_are_deterministic():
    start = datetime(2030, 1, 1, 10, tzinfo=timezone.utc)
    assert RecurrenceService.calculate_next_trigger("daily", 1, start) == datetime(
        2030, 1, 2, 10, tzinfo=timezone.utc
    )
    assert RecurrenceService.calculate_next_trigger("weekdays", 1, datetime(
        2030, 1, 4, 10, tzinfo=timezone.utc
    )) == datetime(2030, 1, 7, 10, tzinfo=timezone.utc)
    assert RecurrenceService.calculate_next_trigger(
        "monthly", 1, start, anchor_day=1
    ) == datetime(2030, 2, 1, 10, tzinfo=timezone.utc)


def test_monthly_recurrence_preserves_anchor_and_clamps_calendar_months():
    def next_month(value: datetime, anchor_day: int) -> datetime:
        return RecurrenceService.calculate_next_trigger(
            "monthly", 1, value, anchor_day=anchor_day
        )

    assert next_month(datetime(2030, 1, 29, tzinfo=timezone.utc), 29) == datetime(
        2030, 2, 28, tzinfo=timezone.utc
    )
    assert next_month(datetime(2030, 1, 30, tzinfo=timezone.utc), 30) == datetime(
        2030, 2, 28, tzinfo=timezone.utc
    )
    assert next_month(datetime(2030, 1, 31, tzinfo=timezone.utc), 31) == datetime(
        2030, 2, 28, tzinfo=timezone.utc
    )
    assert next_month(datetime(2030, 2, 28, tzinfo=timezone.utc), 31) == datetime(
        2030, 3, 31, tzinfo=timezone.utc
    )
    assert next_month(datetime(2030, 3, 31, tzinfo=timezone.utc), 31) == datetime(
        2030, 4, 30, tzinfo=timezone.utc
    )
    assert next_month(datetime(2030, 4, 30, tzinfo=timezone.utc), 31) == datetime(
        2030, 5, 31, tzinfo=timezone.utc
    )
    assert next_month(datetime(2030, 4, 30, tzinfo=timezone.utc), 30) == datetime(
        2030, 5, 30, tzinfo=timezone.utc
    )
    assert next_month(datetime(2030, 12, 31, tzinfo=timezone.utc), 31) == datetime(
        2031, 1, 31, tzinfo=timezone.utc
    )
    assert next_month(datetime(2032, 1, 31, tzinfo=timezone.utc), 31) == datetime(
        2032, 2, 29, tzinfo=timezone.utc
    )


def test_weekly_selected_day_honors_interval():
    start = datetime(2030, 1, 7, 10, tzinfo=timezone.utc)  # Monday
    result = RecurrenceService.calculate_next_trigger(
        "weekly", 2, start, days_of_week=[2], time_of_day="09:00"
    )

    assert result == datetime(2030, 1, 23, 9, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_recurring_rule_update_recalculates_next_trigger_and_preserves_instances(
    client: AsyncClient,
):
    rule = await create_rule(client, "Update timing")
    original_trigger = rule["next_trigger_at"]

    updated = await client.patch(
        f"{API_PREFIX}/recurring-rules/{rule['id']}",
        json={"frequency": "weekly", "interval_val": 2, "days_of_week": [0, 2]},
    )
    assert updated.status_code == 200
    assert updated.json()["next_trigger_at"] != original_trigger
    assert updated.json()["next_trigger_at"].startswith("2030-01-14T09:00:00")

    instances = await client.get(f"{API_PREFIX}/tasks", params={"task_type": "recurring"})
    assert instances.status_code == 200
    assert len(instances.json()) == 1


def test_weekly_selected_days_respect_interval_and_boundaries():
    monday = datetime(2030, 12, 30, 10, tzinfo=timezone.utc)

    assert RecurrenceService.calculate_next_trigger(
        "weekly", 1, monday, days_of_week=[0, 2, 6], time_of_day="09:00"
    ) == datetime(2031, 1, 1, 9, tzinfo=timezone.utc)
    assert RecurrenceService.calculate_next_trigger(
        "weekly", 2, monday, days_of_week=[0, 2, 6], time_of_day="09:00"
    ) == datetime(2031, 1, 13, 9, tzinfo=timezone.utc)
    assert RecurrenceService.calculate_next_trigger(
        "weekly", 3, monday, days_of_week=[0, 2, 6], time_of_day="09:00"
    ) == datetime(2031, 1, 20, 9, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_recurring_rule_weekday_validation(client: AsyncClient):
    for invalid_day in (-1, 7):
        response = await client.post(
            f"{API_PREFIX}/recurring-rules",
            json={
                "title": "Invalid weekday",
                "frequency": "weekly",
                "days_of_week": [invalid_day],
            },
        )
        assert response.status_code == 422

    valid = await client.post(
        f"{API_PREFIX}/recurring-rules",
        json={
            "title": "Boundary weekdays",
            "frequency": "weekly",
            "days_of_week": [6, 0],
        },
    )
    assert valid.status_code == 201
    assert valid.json()["days_of_week"] == [0, 6]


@pytest.mark.asyncio
async def test_due_recurrence_scheduler_generates_once_and_advances_rule(client: AsyncClient, test_engine: AsyncEngine):
    rule = await create_rule(client, "Scheduled automation")
    async with AsyncSession(test_engine) as session:
        from app.models.recurring_rule import RecurringRule

        stored = await session.get(RecurringRule, rule["id"])
        for instance in (await session.scalars(select(Task).where(Task.recurring_rule_id == rule["id"]))).all():
            instance.status = "completed"
        stored.next_trigger_at = datetime(2030, 1, 1, 9, tzinfo=timezone.utc)
        await session.commit()
        generated = await RecurrenceService.generate_due_instances(
            session, datetime(2030, 1, 2, 9, tzinfo=timezone.utc)
        )
        await session.commit()
        assert generated == 1
        await session.refresh(stored)
        first_trigger = stored.next_trigger_at
        generated_again = await RecurrenceService.generate_due_instances(
            session, datetime(2030, 1, 2, 9, tzinfo=timezone.utc)
        )
        assert generated_again == 0
        assert stored.next_trigger_at == first_trigger


@pytest.mark.asyncio
async def test_future_and_disabled_recurrence_rules_are_not_generated(client: AsyncClient, test_engine: AsyncEngine):
    future = await create_rule(client, "Future automation")
    disabled = await create_rule(client, "Disabled automation")
    async with AsyncSession(test_engine) as session:
        from app.models.recurring_rule import RecurringRule

        future_rule = await session.get(RecurringRule, future["id"])
        disabled_rule = await session.get(RecurringRule, disabled["id"])
        for instance in (await session.scalars(select(Task))).all():
            instance.status = "completed"
        future_rule.next_trigger_at = datetime(2099, 1, 1, tzinfo=timezone.utc)
        disabled_rule.enabled = False
        disabled_rule.next_trigger_at = datetime(2030, 1, 1, tzinfo=timezone.utc)
        await session.commit()
        assert await RecurrenceService.generate_due_instances(session, datetime(2030, 1, 2, tzinfo=timezone.utc)) == 0


