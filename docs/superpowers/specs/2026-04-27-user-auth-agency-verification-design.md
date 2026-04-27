# User Auth, Agency Verification, and Image Storage Design

## Context

Voyage is moving from a frontend prototype toward a hosted backend on Railway. The server is currently a thin Node package with Express, Mongoose, Zod, and TypeScript dependencies, plus backend function specs for agency portfolio, approval, and Agent-assisted workflows.

The backend needs a durable account foundation before those agency workflows are implemented. It must support normal users, agency staff, platform admins, email verification, Google sign-in, Apple ID sign-in, agency registration review, and image uploads for profile avatars, agency logos, and trip itinerary media.

## Chosen Stack

Use PostgreSQL with Prisma for primary persistence.

Use Railway Storage Buckets for uploaded image files.

Use an S3-compatible storage client for upload and download operations, so the storage layer can later move to AWS S3, Cloudflare R2, Backblaze B2, or another S3-compatible provider without redesigning the app data model.

Replace the initial Mongoose direction with Prisma models and migrations. The current server has no application source yet, so this is a low-cost switch.

## Goals

- Support one account system for normal users, agency staff, and platform admins.
- Allow users to sign in before email verification.
- Let unverified users use normal user features.
- Block agency registration until the user verifies their email.
- Require platform admin review before an agency becomes verified.
- Reject duplicate email registration.
- Support email/password, Google sign-in, and Apple ID sign-in.
- Store actual images outside PostgreSQL.
- Store image ownership, purpose, and access metadata in PostgreSQL.
- Preserve a clean future path for agency portfolios, client approvals, and Agent workflows.

## Non-Goals

- No full agency dashboard implementation in this auth phase.
- No payment, subscription, or billing system.
- No client invitation workflow yet.
- No public marketplace or agency discovery workflow.
- No direct binary image storage in PostgreSQL.
- No initial requirement for passwordless login.

## Account Model

Use a single `User` table for every person.

A user can later become:

- A normal traveler or personal app user.
- An agency owner.
- An agency staff member.
- A platform admin.

This avoids splitting people across separate normal-user and agency-user tables. It also makes Google and Apple identity linking simpler because provider accounts link to one stable user record.

## Roles and Statuses

### User Role

`User.role` controls platform-level authority:

- `USER`: default account role.
- `ADMIN`: platform admin who can review and verify agencies.

Agency-specific permissions do not live on `User.role`; they live on `AgencyMembership.role`.

### User Status

`User.status` supports account lifecycle control:

- `ACTIVE`: default usable account.
- `DISABLED`: blocked from sign-in by platform action.

### Agency Status

`Agency.status` controls whether agency functionality is available:

- `PENDING_REVIEW`: submitted by a verified user, waiting for admin review.
- `VERIFIED`: approved by a platform admin.
- `REJECTED`: reviewed and declined, with a stored reason.
- `SUSPENDED`: previously verified agency is temporarily blocked.

### Agency Membership Role

`AgencyMembership.role` controls a user's authority inside an agency:

- `OWNER`: created the agency application and controls agency settings after approval.
- `ADMIN`: can manage agency staff and operational settings.
- `STAFF`: can work on assigned agency trips and approvals.

## Core Data Model

### User

Stores the canonical identity.

Fields:

- `id`
- `email`
- `emailNormalized`
- `passwordHash`
- `displayName`
- `role`
- `status`
- `emailVerifiedAt`
- `avatarImageId`
- `createdAt`
- `updatedAt`

Rules:

- `emailNormalized` is unique.
- `passwordHash` is nullable for OAuth-only users.
- `emailVerifiedAt` is nullable until verification succeeds.
- A user can sign in while `emailVerifiedAt` is null.
- Agency registration requires `emailVerifiedAt` to be set.

### AuthProviderAccount

Links OAuth provider identities to users.

Fields:

- `id`
- `userId`
- `provider`
- `providerAccountId`
- `providerEmail`
- `providerEmailVerified`
- `createdAt`
- `updatedAt`

Rules:

- `provider` is `GOOGLE` or `APPLE`.
- `(provider, providerAccountId)` is unique.
- If a provider returns a verified email matching an existing user, the backend can link the provider after the user proves account control through the OAuth callback.
- OAuth-created users can be marked verified when the provider confirms the email is verified.

### EmailVerificationToken

Stores hashed email verification tokens.

Fields:

- `id`
- `userId`
- `tokenHash`
- `expiresAt`
- `usedAt`
- `createdAt`

Rules:

- Store only a hash of the token.
- Tokens expire.
- Verification sets `User.emailVerifiedAt`.
- Used tokens cannot be reused.
- A resend flow invalidates or supersedes older unused tokens for the same user.

### Agency

Stores agency workspace and verification state.

Fields:

- `id`
- `name`
- `slug`
- `status`
- `ownerUserId`
- `logoImageId`
- `submittedAt`
- `verifiedAt`
- `verifiedByAdminUserId`
- `rejectedAt`
- `rejectedByAdminUserId`
- `rejectionReason`
- `suspendedAt`
- `suspendedByAdminUserId`
- `suspensionReason`
- `createdAt`
- `updatedAt`

Rules:

- New agencies start as `PENDING_REVIEW`.
- Only verified users can create agency applications.
- Only platform admins can set an agency to `VERIFIED`, `REJECTED`, or `SUSPENDED`.
- Agency portfolio, staff, client trip, approval, and agency-branded features require `Agency.status = VERIFIED`.

### AgencyMembership

Connects users to agencies.

Fields:

- `id`
- `agencyId`
- `userId`
- `role`
- `status`
- `createdAt`
- `updatedAt`

Rules:

- `(agencyId, userId)` is unique.
- Agency creator receives `OWNER` membership when the agency application is created.
- Membership access is constrained by both membership status and agency status.

### ImageAsset

Stores metadata for files kept in Railway Storage Buckets.

Fields:

- `id`
- `ownerUserId`
- `agencyId`
- `tripId`
- `purpose`
- `bucket`
- `objectKey`
- `mimeType`
- `sizeBytes`
- `width`
- `height`
- `checksum`
- `status`
- `createdAt`
- `updatedAt`

Purposes:

- `PROFILE_AVATAR`
- `AGENCY_LOGO`
- `TRIP_ITINERARY_IMAGE`
- `CLIENT_ITINERARY_IMAGE`

Rules:

- PostgreSQL stores metadata only.
- Railway Storage Buckets store the actual image bytes.
- Uploads are private by default.
- The backend issues presigned upload URLs after checking user permissions.
- The backend issues presigned read URLs after checking user permissions.
- Profile avatars and agency logos can later have more permissive CDN/public caching rules, but the first version should keep the access model consistent and backend-controlled.

### AdminAuditEvent

Records platform admin decisions.

Fields:

- `id`
- `adminUserId`
- `action`
- `targetType`
- `targetId`
- `reason`
- `metadata`
- `createdAt`

Events:

- Agency approved.
- Agency rejected.
- Agency suspended.
- Agency unsuspended.
- User promoted to admin.
- User disabled.

## Auth Flows

### Email Registration

1. Client submits email, password, and display name.
2. Backend normalizes email.
3. Backend checks whether `emailNormalized` already exists.
4. If the email is taken, backend returns a duplicate-email error.
5. Backend creates the user with `emailVerifiedAt = null`.
6. Backend creates a verification token.
7. Backend sends or queues a verification email.
8. Backend signs the user in immediately.
9. App shows a verify-email prompt after sign-in.

### Email Sign-In

1. Client submits email and password.
2. Backend normalizes email and finds the user.
3. Backend verifies the password hash.
4. Backend rejects disabled accounts.
5. Backend creates a session or returns auth tokens.
6. Backend includes `emailVerifiedAt` and user capabilities in the response.

### Email Verification After Sign-In

1. Signed-in user clicks a verify-email action in the app.
2. Backend creates a new verification token if needed.
3. Backend sends the verification link to the user's email.
4. User opens the link.
5. Backend verifies token hash, expiry, and unused state.
6. Backend sets `EmailVerificationToken.usedAt`.
7. Backend sets `User.emailVerifiedAt`.
8. App refreshes current user capabilities.

### Google Sign-In

1. Client starts Google OAuth.
2. Backend verifies the OAuth callback or identity token.
3. Backend checks provider account linkage.
4. If linked, backend signs in the existing user.
5. If not linked, backend checks for an existing normalized email.
6. If the email exists, backend links Google after provider verification rules pass.
7. If no user exists, backend creates a new user.
8. If Google confirms the email is verified, backend sets `emailVerifiedAt`.

### Apple ID Sign-In

1. Client starts Apple OAuth.
2. Backend verifies the Apple identity token and issuer/audience claims.
3. Backend links or creates the user through `AuthProviderAccount`.
4. If Apple confirms a verified email, backend sets `emailVerifiedAt`.
5. If Apple supplies a private relay email, the relay email becomes the account email unless the user later adds a different verified email through an account settings flow.

## Agency Registration and Verification

### Submit Agency Registration

1. Signed-in user submits agency details.
2. Backend checks `User.emailVerifiedAt`.
3. If the user is unverified, backend rejects the request with a clear `EMAIL_VERIFICATION_REQUIRED` error.
4. Backend creates `Agency.status = PENDING_REVIEW`.
5. Backend creates `AgencyMembership.role = OWNER` for the submitting user.
6. Backend records an audit/activity event.
7. App shows the agency as pending admin review.

### Admin Review

1. Platform admin requests pending agencies.
2. Backend verifies `User.role = ADMIN`.
3. Admin views submitted agency details.
4. Admin approves, rejects, or suspends.
5. Backend updates agency status.
6. Backend records `AdminAuditEvent`.
7. Agency owner sees the updated status in the app.

### Verified Agency Feature Gate

Agency-only features require:

- signed-in user,
- active user account,
- agency membership,
- active membership,
- `Agency.status = VERIFIED`,
- sufficient agency role for the requested operation.

This gate applies to:

- agency portfolio dashboard data,
- staff management,
- client trip creation,
- approval requests,
- agency logo management,
- trip itinerary media management,
- Agent agency portfolio review actions.

## Image Upload Flow

### Request Upload

1. Client asks backend for an upload URL with purpose, mime type, file size, and related object IDs.
2. Backend validates file type and size.
3. Backend checks permissions:
   - profile avatar: signed-in user can update self.
   - agency logo: verified agency owner/admin can update.
   - trip itinerary image: verified agency member with trip access can upload.
   - client itinerary image: verified agency member with trip access can upload.
4. Backend creates an `ImageAsset` row with `status = PENDING_UPLOAD`.
5. Backend returns a presigned upload URL and object key.

### Complete Upload

1. Client uploads directly to Railway Storage Bucket.
2. Client notifies backend that upload completed.
3. Backend verifies object metadata when possible.
4. Backend updates `ImageAsset.status = READY`.
5. Backend links the image to the user, agency, or trip record.

### Read Image

1. Client requests an image URL.
2. Backend checks ownership and access.
3. Backend returns a short-lived presigned read URL.

### Delete or Replace Image

1. Backend marks the old image as replaced or deleted.
2. Backend links the new image.
3. A cleanup job removes orphaned bucket objects.

## API Surface

Initial endpoints:

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /auth/email/check`
- `POST /auth/email/verification/request`
- `POST /auth/email/verification/confirm`
- `GET /auth/google/start`
- `GET /auth/google/callback`
- `GET /auth/apple/start`
- `POST /auth/apple/callback`
- `POST /agencies`
- `GET /agencies/me`
- `GET /admin/agencies/pending`
- `POST /admin/agencies/:agencyId/approve`
- `POST /admin/agencies/:agencyId/reject`
- `POST /admin/agencies/:agencyId/suspend`
- `POST /images/upload-url`
- `POST /images/:imageId/complete`
- `GET /images/:imageId/url`

## Admin Bootstrap

The first admin should be created through a seed script or configured admin email allowlist.

Do not expose an unauthenticated endpoint that promotes arbitrary users to platform admin.

Expected first implementation:

- Read `ADMIN_EMAILS` from environment for local and staging bootstrap.
- Provide a Prisma seed script that promotes matching existing users to `ADMIN`.
- Record an `AdminAuditEvent` when promotion is run against an existing account.

## Security Rules

- Hash passwords with a modern password hashing function.
- Normalize email before uniqueness checks.
- Never store raw email verification tokens.
- Keep OAuth provider IDs unique per provider.
- Keep object storage private by default.
- Issue short-lived presigned URLs.
- Validate image MIME type and size before upload.
- Recheck permissions before returning image read URLs.
- Audit platform admin decisions.
- Do not let unverified users create agency applications.
- Do not let pending agencies access verified-agency operations.

## Testing Direction

Unit tests:

- Email normalization and duplicate email rejection.
- Password registration and login validation.
- Email verification token creation, expiry, use, and reuse rejection.
- User capability calculation for verified and unverified users.
- Agency registration rejection for unverified users.
- Agency registration success for verified users.
- Admin approval, rejection, and suspension rules.
- Image upload permission rules per image purpose.

Integration tests:

- Register, sign in, request verification, confirm verification.
- Register verified agency application, approve agency as admin, then access agency endpoint.
- OAuth user creation and provider account linking.
- Presigned upload URL creation with ImageAsset metadata.

## Implementation Defaults

- Use secure HTTP-only cookie sessions for the web app. If the frontend and backend are on separate Railway domains, configure CORS credentials and `SameSite=None; Secure` in production.
- Use Resend as the first transactional email provider for verification emails.
- Use provider-backed token verification for Google and Apple with strict issuer, audience, expiry, and provider account ID checks.
- Allow `image/jpeg`, `image/png`, and `image/webp` uploads in the first version. Do not allow SVG uploads in user-controlled image fields.
- Limit profile avatars to 2 MB.
- Limit agency logos to 2 MB.
- Limit trip and client itinerary images to 8 MB.
- Keep profile avatars and agency logos private in the first backend version, served through backend-authorized presigned URLs. Add public/CDN delivery only after the access and caching rules are explicit.
