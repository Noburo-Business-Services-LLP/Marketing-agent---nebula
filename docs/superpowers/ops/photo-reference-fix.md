# Photo with no text: offer as reference

Bug: a photo dropped on the Videos idea box returned a dead-end "Nothing readable" message.
Fix: backend message now says no printed text was found and points to person/place/product references.
IdeaBoxTools takes optional `referenceChoices`; an image with no text shows one button per choice, which hands
`{ name, dataUrl }` back (data URL kept from upload time). CreateVideo wires person (max 2), place (1), product (max 2, as the picker).
When a person/product list is full the choice returns a one-line note instead of a false confirmation.
Pure logic in frontend/utils/ideaFiles.ts: isNoTextResult, referenceAssetFromFile, referenceOfferFor (tests in tests/ideaFiles.test.mjs).
