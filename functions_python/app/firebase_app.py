"""Firebase Admin / Firestore app initialization, shared by every module."""

import time

import firebase_admin
from firebase_admin import firestore
from firebase_functions import options

options.set_global_options(region="europe-west3", max_instances=10)

firebase_admin.initialize_app()


class _LazyFirestoreClient:
    """Defers firestore.client() (and its credential lookup) until first use.

    The Firebase CLI's local "analyze codebase" step (during `firebase deploy`)
    imports this module in a plain Python process with no Application Default
    Credentials configured. Building the client eagerly at import time crashes
    that step; real function invocations (emulator or deployed) always have
    credentials available by the time a request actually touches Firestore.
    """

    def __init__(self):
        self._client = None

    def _get(self):
        if self._client is None:
            self._client = firestore.client()
        return self._client

    def __getattr__(self, name):
        return getattr(self._get(), name)


db = _LazyFirestoreClient()

PROCESS_START = time.monotonic()
