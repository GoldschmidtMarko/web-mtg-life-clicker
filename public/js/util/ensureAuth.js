// Bootstraps a Firebase Auth session with zero friction: if no session
// exists yet (first visit, or a previous session expired), signs in
// anonymously so every page works without requiring a Google account.
// Google sign-in remains available as an optional upgrade (see the
// sign-in button logic in indexScript.js) that links onto the same uid.
//
// Callers must have already run firebase.initializeApp(...) before calling
// this. Resolves with the first non-null firebase.User once available.
export function ensureSignedIn() {
    return new Promise((resolve, reject) => {
        const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
            if (user) {
                unsubscribe();
                resolve(user);
                return;
            }
            firebase.auth().signInAnonymously().catch((error) => {
                unsubscribe();
                reject(error);
            });
        }, (error) => {
            unsubscribe();
            reject(error);
        });
    });
}
