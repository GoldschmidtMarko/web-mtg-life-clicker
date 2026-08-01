"""Firebase Admin / Firestore app initialization, shared by every module."""

import time

import firebase_admin
from firebase_admin import firestore
from firebase_functions import options

options.set_global_options(region="europe-west3", max_instances=10)

firebase_admin.initialize_app()
db = firestore.client()

PROCESS_START = time.monotonic()
