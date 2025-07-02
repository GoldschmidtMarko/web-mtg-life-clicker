const admin = require('firebase-admin');

// Initialize the Admin SDK
admin.initializeApp(); // Make sure this is initialized elsewhere with your credentials

async function copySubcollections(oldDocRef, newDocRef, writeBatch, deleteBatch) {
  // Get a list of subcollections for the current document.
  // This might require you to know the names of your subcollections beforehand.
  // Alternatively, you could try to list collections using Admin SDK (more advanced)
  const subcollectionNames = ['players', 'another_subcollection']; // <--- REPLACE with your actual subcollection names

  for (const subcollectionName of subcollectionNames) {
    const oldSubcollectionRef = oldDocRef.collection(subcollectionName);
    const newSubcollectionRef = newDocRef.collection(subcollectionName);

    const subcollectionSnapshot = await oldSubcollectionRef.get();

    subcollectionSnapshot.forEach((subDoc) => {
      const newSubDocRef = newSubcollectionRef.doc(subDoc.id);
      writeBatch.set(newSubDocRef, subDoc.data());
      deleteBatch.delete(subDoc.ref);

      // Recursively call to handle nested subcollections
      copySubcollections(subDoc.ref, newSubDocRef, writeBatch, deleteBatch);
    });
  }
}

async function renameCollection(oldCollectionPath, newCollectionPath) {
  const firestore = admin.firestore();
  const oldCollectionRef = firestore.collection(oldCollectionPath);
  const newCollectionRef = firestore.collection(newCollectionPath);

  try {
    const snapshot = await oldCollectionRef.get();

    if (snapshot.empty) {
      console.log('No documents found in the old collection.');
      return;
    }

    const writeBatch = firestore.batch();
    const deleteBatch = firestore.batch();

    snapshot.forEach(async (doc) => { // Use async here because copySubcollections is async
      const newDocRef = newCollectionRef.doc(doc.id);
      writeBatch.set(newDocRef, doc.data());
      deleteBatch.delete(doc.ref);

      // Call the helper function to copy subcollections for this document
      await copySubcollections(doc.ref, newDocRef, writeBatch, deleteBatch);
    });

    // After the loop, commit the batches
    await writeBatch.commit();
    console.log('Documents and subcollections copied to the new collection.');

    await deleteBatch.commit();
    console.log('Old collection and subcollections documents deleted.');

    console.log(`Collection "${oldCollectionPath}" effectively renamed to "${newCollectionPath}".`);

  } catch (error) {
    console.error('Error renaming collection:', error);
  }
}

// Example usage:
renameCollection('test', 'gero');
