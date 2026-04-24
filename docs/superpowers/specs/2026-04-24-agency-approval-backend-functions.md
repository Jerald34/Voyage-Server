# Agency Approval Backend Functions

## Purpose

This file lists the backend functions needed for client approval blockers on the agency portfolio homepage. These functions track what the agency is waiting on from clients and support Agent-assisted follow-up.

## Approval Request Functions

### `createApprovalRequest(tripId, agencyId, payload)`

Creates a client approval request.

Payload should include:

- Approval type
- Request title
- Request message
- Due date
- Client recipient IDs
- Related itinerary, booking, proposal, or document IDs

Returns:

- Approval request ID
- Approval status
- Client-facing approval link or token

### `listApprovalRequests(agencyId, filters, pagination)`

Returns approval requests across the agency portfolio.

Inputs:

- `agencyId`
- Filters for status, approval type, trip ID, client ID, due date, and assigned organizer
- Pagination and sort options

Returns each request with:

- Approval request ID
- Trip ID
- Client name
- Destination
- Approval type
- Status
- Due date
- Last reminder timestamp
- Blocking status

### `listTripApprovalRequests(tripId, agencyId)`

Returns all approval requests for one client trip.

Inputs:

- `tripId`
- `agencyId`

Returns:

- Approval request list
- Current blocking approval if one exists
- Approval timeline

### `getApprovalBlockers(agencyId, filters)`

Returns only approval requests that block trip production.

Inputs:

- `agencyId`
- Optional filters for due date, organizer, trip status, and approval type

Returns:

- Blocking approval requests
- Blocker severity
- Days waiting
- Recommended follow-up action

## Approval State Changes

### `markApprovalRequested(approvalRequestId, staffUserId)`

Marks an approval request as sent to the client.

Inputs:

- `approvalRequestId`
- `staffUserId`

Returns:

- Updated approval status
- Sent timestamp
- Audit event ID

### `recordClientApprovalResponse(approvalRequestId, clientUserId, response)`

Records the client's response.

Response can include:

- Approved
- Requested changes
- Declined
- Comment
- Selected option IDs

Returns:

- Updated approval status
- Response timestamp
- Any newly created production tasks

### `cancelApprovalRequest(approvalRequestId, staffUserId, reason)`

Cancels an approval request that is no longer needed.

Inputs:

- `approvalRequestId`
- `staffUserId`
- Cancellation reason

Returns:

- Updated approval status
- Audit event ID

## Reminder and Communication Functions

### `sendApprovalReminder(approvalRequestId, staffUserId, messagePayload)`

Sends a reminder to the client for a pending approval.

Inputs:

- `approvalRequestId`
- `staffUserId`
- Message subject
- Message body
- Channel

Returns:

- Delivery status
- Reminder timestamp
- Communication ID

### `listApprovalReminderHistory(approvalRequestId)`

Returns reminders sent for an approval request.

Inputs:

- `approvalRequestId`

Returns:

- Reminder timestamps
- Message channels
- Delivery states
- Sender IDs

### `getClientCommunicationPreferences(clientId, agencyId)`

Returns the best channel and contact rules for a client.

Inputs:

- `clientId`
- `agencyId`

Returns:

- Preferred channel
- Email address or phone metadata
- Time zone
- Communication restrictions

## Dashboard Support Functions

### `countAwaitingApprovals(agencyId, filters)`

Returns the count used by the agency metrics strip.

Inputs:

- `agencyId`
- Optional filters for organizer, departure window, and approval type

Returns:

- Total awaiting approvals
- Blocking approvals count
- Overdue approvals count

### `getApprovalStatusLabel(approvalStatus)`

Normalizes approval states into dashboard-friendly labels.

Inputs:

- Raw approval status

Returns:

- Label
- Tone: neutral, warning, danger, success
- Whether the status blocks production

### `syncApprovalStatusToTripReadiness(tripId, agencyId)`

Updates trip readiness when approval state changes.

Inputs:

- `tripId`
- `agencyId`

Returns:

- Updated readiness percent
- Updated risk level
- Readiness items affected by approval state

## Future Client View Support

These functions will later support the separate client-facing page without changing the agency dashboard contract.

### `getClientApprovalPortal(approvalToken)`

Returns the client-facing approval page data for one approval request.

### `submitClientApprovalPortalResponse(approvalToken, response)`

Submits the client's approval response from the client-facing page.
