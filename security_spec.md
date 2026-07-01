# Security Specification & Threat Model

This document outlines the security architecture and invariants for the English Exam Prep Application, ensuring strong constraints against identity spoofing, privilege escalation, and resource exhaustion.

## 1. Data Invariants

1. **User Ownership**: A regular user profile (`/users/{userId}`) can only be read or modified by the user themselves (`request.auth.uid == userId`). Upgrading high-privilege keys like `role` or `expiresAt` is strictly forbidden for regular users.
2. **Admin Supremacy**: Users with the `role == 'admin'` can bypass restrictions to manage exams, extensions, and users.
3. **Exams Readability**: Exams are public and can be listed and read by guests and logged-in students. But they can only be created, modified, or deleted by verified admins.
4. **Attempts Isolations**: Authenticated students must only see their own exam attempts (`resource.data.userId == request.auth.uid`). Guests can submit guest attempts, and admins can view all history.
5. **Feedbacks Integrity**: Students can submit feedbacks, but only admins can review or resolve them.

## 2. The Dirty Dozen Payloads (Fail Cases)

Below are the 12 malicious payloads that the security rules must reject to keep the application secure.

1. **Self-Escalation**: A standard user attempting to create/update `/users/{uid}` with `"role": "admin"`.
2. **Access Expiration Tampering**: A standard user trying to extend their subscription by changing `"expiresAt"`.
3. **Identity Impersonation (Attempt ID)**: A user saving a scoring result under another user's `userId`.
4. **Exam Poisoning (Ghost Fields)**: An unauthorized person trying to create/write an exam doc or inject arbitrary properties like `"isFake": true`.
5. **PII Breach**: A regular student trying to read another student's profile.
6. **Bypassing Invariant checks**: Creating an attempt with incorrect field structures, missing scores, or negative scoring indices.
7. **Junk ID Poisoning**: Trying to create an exam with a 10KB string as its ID.
8. **Malicious Key Transformation**: Updating an exam key directly on the client instead of using administrative routes.
9. **Extension Spoofing**: A non-admin posting an extension log.
10. **Feedback Scrubbing**: A student attempting to delete a feedback flag they filed or someone else filed.
11. **Terminal Status Bypass**: Trying to update a resolved feedback item once it is marked completed.
12. **Blanket Query Scraping**: Running an unconstrained listing request on `/attempts` to read all students' scores.

## 3. Test Runner Configuration

We define the corresponding `firestore.rules` containing our access criteria.
