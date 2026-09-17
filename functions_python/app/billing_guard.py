"""Automated budget backstop.

GCP budgets are informational only - hitting 100% just sends an email, it
never stops spend on its own. budgetGuard is a Pub/Sub handler a Cloud
Billing budget notification can be wired to (see the gcloud setup in the
repo's budget-guard notes); once spend reaches the budget, it scales every
other function's max instance count to zero so Cloud Functions stop
accepting new invocations. restoreFunctionCapacity is the (admin-only) way
back once the underlying cost issue has been investigated.

Uses the Cloud Functions Admin API (v2) rather than the Cloud Run API that
actually backs Gen2 functions, so every call can reference functions by the
exact ids already used everywhere else in this repo (main.py's exports,
WARMUP_FUNCTIONS, ...) instead of guessing at Firebase's function-id ->
Cloud Run service-id transform.
"""

from firebase_functions import https_fn, options, pubsub_fn
from google.cloud import functions_v2
from google.protobuf import field_mask_pb2

from .admin import _is_admin
from .common import Err, authenticate_user

PROJECT_ID = "web-mtg-life-clicker"
REGION = "europe-west3"
NORMAL_MAX_INSTANCES = 10  # matches options.set_global_options in firebase_app.py

# Never scaled down: budgetGuard must stay invokable to run at all, and
# restoreFunctionCapacity is the only way back once everything else is at zero.
_PROTECTED_FUNCTIONS = {"budgetGuard", "restoreFunctionCapacity"}

# The google-cloud-functions client (grpc + protobuf) plus main.py loading
# every other module's imports (including matplotlib, for charts.py) at
# container startup runs this well past the default 256MiB - it OOM'd
# mid-update on the very first real run, which is worse than doing nothing:
# a killed container can leave an individual function's update stuck in
# DEPLOYING, which then rejects any further update to that same function
# with a 409 until it clears on its own.
_GUARD_MEMORY = options.MemoryOption.MB_512


def _set_max_instances(max_instances: int) -> dict:
    client = functions_v2.FunctionServiceClient()
    parent = client.common_location_path(PROJECT_ID, REGION)

    updated = []
    skipped = []
    failed = []
    for function in client.list_functions(parent=parent):
        function_id = function.name.rsplit("/", 1)[-1]
        if function_id in _PROTECTED_FUNCTIONS:
            skipped.append(function_id)
            continue

        function.service_config.max_instance_count = max_instances
        try:
            client.update_function(
                function=function,
                update_mask=field_mask_pb2.FieldMask(paths=["service_config.max_instance_count"]),
            )
            updated.append(function_id)
        except Exception as error:
            # One function already mid-update (e.g. a previous run still
            # DEPLOYING) shouldn't stop the rest from being attempted.
            print(f"_set_max_instances: failed to update {function_id}: {error}")
            failed.append(function_id)

    return {"updated": updated, "skipped": skipped, "failed": failed}


@pubsub_fn.on_message_published(topic="budget-alerts", memory=_GUARD_MEMORY)
def budgetGuard(event: pubsub_fn.CloudEvent) -> None:
    payload = event.data.message.json or {}
    cost = payload.get("costAmount")
    budget = payload.get("budgetAmount")

    print(f"budgetGuard: costAmount={cost} budgetAmount={budget}")

    if not budget or cost is None or cost / budget < 1.0:
        return

    result = _set_max_instances(0)
    print(f"budgetGuard: budget exceeded, scaled to zero: {result['updated']}"
          + (f" (FAILED: {result['failed']})" if result["failed"] else ""))


@https_fn.on_call(memory=_GUARD_MEMORY)
def restoreFunctionCapacity(request: https_fn.CallableRequest) -> dict:
    """Admin-only recovery from budgetGuard: puts every function back to
    the normal max-instance count."""
    authenticate_user(request.auth)
    if not _is_admin(request):
        raise https_fn.HttpsError(Err.PERMISSION_DENIED, "Not authorized.")

    result = _set_max_instances(NORMAL_MAX_INSTANCES)
    return {
        "message": f"Restored {len(result['updated'])} functions to max_instance_count={NORMAL_MAX_INSTANCES}.",
        **result,
    }
