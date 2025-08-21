#!/bin/bash

# Convenience script for Firebase development
# Make sure you have the FIREBASE_TOKEN environment variable set

if [ -z "$FIREBASE_TOKEN" ]; then
    echo "Error: FIREBASE_TOKEN environment variable is not set"
    echo "Please run: source ~/.bashrc"
    exit 1
fi

echo "🔥 Firebase Development Script"
echo "Available commands:"
echo "  start-emulators  - Start Firebase emulators"
echo "  test-functions   - Test Firebase functions locally"
echo "  deploy-functions - Deploy functions to Firebase"
echo "  deploy-hosting   - Deploy hosting to Firebase"
echo "  deploy-all       - Deploy everything to Firebase"
echo "  serve-hosting    - Serve hosting locally"
echo ""

case "$1" in
    "start-emulators")
        echo "Starting Firebase emulators..."
        firebase emulators:start --token "$FIREBASE_TOKEN"
        ;;
    "test-functions")
        echo "Testing Firebase functions locally..."
        cd functions && npm run serve
        ;;
    "deploy-functions")
        echo "Deploying Firebase functions..."
        firebase deploy --only functions --token "$FIREBASE_TOKEN"
        ;;
    "deploy-hosting")
        echo "Deploying Firebase hosting..."
        firebase deploy --only hosting --token "$FIREBASE_TOKEN"
        ;;
    "deploy-all")
        echo "Deploying everything to Firebase..."
        firebase deploy --token "$FIREBASE_TOKEN"
        ;;
    "serve-hosting")
        echo "Serving hosting locally..."
        firebase serve --only hosting --token "$FIREBASE_TOKEN"
        ;;
    *)
        echo "Usage: $0 {start-emulators|test-functions|deploy-functions|deploy-hosting|deploy-all|serve-hosting}"
        exit 1
        ;;
esac
