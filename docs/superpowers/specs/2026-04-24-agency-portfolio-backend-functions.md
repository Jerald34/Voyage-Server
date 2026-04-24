# Agency Portfolio Backend Functions

## Purpose

This file lists the backend functions needed to support the agency portfolio homepage. These functions power the dashboard-wide portfolio view, metrics, urgency ranking, and trip list.

## Portfolio Read Functions

### `getAgencyPortfolioSummary(agencyId, filters)`

Returns top-level counts for the agency dashboard.

Inputs:

- `agencyId`
- Optional filters such as `dateRange`, `organizerId`, `tripStatus`, and `riskLevel`

Returns:

- Active trip count
- Departures inside 30 days
- Trips awaiting client approval
- At-risk trip count
- Last portfolio review timestamp

### `listAgencyClientTrips(agencyId, filters, pagination)`

Returns the active client trip portfolio list.

Inputs:

- `agencyId`
- Filters for status, destination, organizer, departure window, approval status, and risk level
- Pagination and sort options

Returns each trip with:

- Trip ID
- Client name
- Destination
- Travel window
- Departure date
- Assigned organizer
- Readiness percent
- Approval status
- Risk level
- Next action
- Last updated timestamp

### `getClientTripDetail(tripId, agencyId)`

Returns the internal production detail for one client trip.

Inputs:

- `tripId`
- `agencyId`

Returns:

- Client profile summary
- Trip brief
- Itinerary days
- Booking status entries
- Approval state
- Production checklist
- Agent context for the trip

## Urgency Functions

### `listUrgentDepartures(agencyId, windowDays)`

Returns trips departing soon, ordered by departure date and readiness risk.

Inputs:

- `agencyId`
- `windowDays`, defaulting to `30`

Returns:

- Trips departing within the window
- Days until departure
- Readiness percent
- Risk level
- Missing production items
- Recommended next action

### `calculateTripReadiness(tripId)`

Calculates a readiness percentage for a trip.

Inputs:

- `tripId`

Readiness can consider:

- Itinerary completion
- Client approval status
- Booking confirmation status
- Missing traveler details
- Final review status
- Departure checklist completion

Returns:

- Readiness percent
- Completed readiness items
- Missing readiness items
- Risk explanation

### `calculatePortfolioRisk(agencyId)`

Calculates risk across the agency portfolio.

Inputs:

- `agencyId`

Returns:

- Count of low, medium, and high-risk trips
- Highest-risk trip IDs
- Risk reasons grouped by category
- Portfolio-level recommendation summary

## Write Functions

### `createClientTrip(agencyId, payload)`

Creates a new client trip record.

Payload should include:

- Client name
- Destination
- Travel window
- Departure date
- Assigned organizer
- Initial trip brief

Returns:

- Created trip ID
- Created trip summary

### `updateClientTrip(tripId, agencyId, patch)`

Updates trip-level portfolio fields.

Patch can include:

- Destination
- Travel window
- Departure date
- Assigned organizer
- Trip status
- Internal notes

Returns:

- Updated trip summary

### `assignTripOrganizer(tripId, agencyId, organizerId)`

Assigns or changes the staff owner for a client trip.

Inputs:

- `tripId`
- `agencyId`
- `organizerId`

Returns:

- Updated assignment
- Audit event ID

## Audit and Activity Functions

### `listTripActivity(tripId, agencyId, pagination)`

Returns recent activity for a client trip.

Activity examples:

- Client approval requested
- Reminder drafted
- Readiness changed
- Organizer assigned
- Itinerary updated
- Agent review completed

### `recordTripActivity(tripId, agencyId, event)`

Writes an audit event for agency and Agent actions.

Event should include:

- Actor type: staff, agent, client, or system
- Actor ID when available
- Event type
- Human-readable event summary
- Related object ID when available

## Empty State Support

### `hasAgencyPortfolioData(agencyId)`

Checks whether the agency has any client trips yet.

Returns:

- Boolean portfolio existence
- Optional onboarding state
- Suggested next setup action
