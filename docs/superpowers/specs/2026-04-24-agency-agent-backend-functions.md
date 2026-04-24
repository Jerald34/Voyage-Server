# Agency Agent Backend Functions

## Purpose

This file lists the backend functions needed to make the Voyage Agent useful on the agency portfolio homepage. The Agent should scan active client trips, rank priorities, explain risks, and prepare staff actions.

## Portfolio Agent Review

### `runAgencyPortfolioReview(agencyId, options)`

Runs an Agent review across active client trips.

Inputs:

- `agencyId`
- Optional filters such as organizer, departure window, and trip status
- Optional review mode: quick, standard, or deep

Returns:

- Review ID
- Generated summary
- Priority queue items
- Approval blockers
- Urgent departures
- Risk findings
- Suggested next actions
- Review timestamp

### `getLatestAgencyPortfolioReview(agencyId)`

Returns the latest completed Agent portfolio review.

Inputs:

- `agencyId`

Returns:

- Review ID
- Review timestamp
- Portfolio insight summary
- Priority queue snapshot
- Action recommendations

### `listAgentPriorityQueue(agencyId, filters)`

Returns the Agent-ranked priority queue for the dashboard.

Inputs:

- `agencyId`
- Optional filters for assigned organizer, risk level, approval status, and departure window

Returns each queue item with:

- Trip ID
- Client name
- Destination
- Priority score
- Priority reason
- Departure urgency
- Approval blocker status
- Readiness percent
- Recommended action
- Action type

## Agent Reasoning and Ranking

### `scoreTripPriority(tripId)`

Calculates a priority score for one trip.

Inputs:

- `tripId`

Scoring should consider:

- Days until departure
- Approval blocker severity
- Readiness percent
- Risk level
- Missing production items
- Client inactivity duration
- Organizer workload

Returns:

- Priority score
- Priority tier
- Ranked reasons

### `generateTripRiskInsight(tripId)`

Generates a human-readable risk explanation for a trip.

Inputs:

- `tripId`

Returns:

- Short Agent insight
- Risk category
- Recommended action
- Supporting facts used by the Agent

### `summarizeAgencyPortfolio(agencyId)`

Generates the concise summary shown in the Agent Command Center.

Inputs:

- `agencyId`

Returns:

- One-line portfolio summary
- Insight chips
- Recommended primary action
- Recommended secondary action

## Agent Action Drafting

### `draftClientApprovalReminder(tripId, agencyId, context)`

Drafts a client reminder for an approval blocker.

Inputs:

- `tripId`
- `agencyId`
- Reminder context such as approval type and due date

Returns:

- Draft subject
- Draft message
- Suggested channel
- Related approval request ID
- Requires staff review flag

### `draftDepartureReadinessSummary(tripId, agencyId)`

Drafts an internal readiness summary for a trip departing soon.

Inputs:

- `tripId`
- `agencyId`

Returns:

- Readiness summary
- Completed items
- Missing items
- Recommended staff actions

### `prepareDailyAgencyFollowUps(agencyId, options)`

Builds a daily follow-up package for staff.

Inputs:

- `agencyId`
- Optional organizer filter
- Optional include/exclude action types

Returns:

- Follow-up draft list
- Client reminders
- Internal task summaries
- Trips requiring manual review

## Agent Action Lifecycle

### `createAgentAction(agencyId, tripId, actionPayload)`

Creates a pending Agent-assisted action.

Action examples:

- Draft reminder
- Review readiness
- Summarize blockers
- Prepare final checklist
- Open trip with context

Returns:

- Agent action ID
- Action status
- Draft output if generated immediately

### `approveAgentAction(agentActionId, staffUserId)`

Approves an Agent-generated action before sending or applying it.

Inputs:

- `agentActionId`
- `staffUserId`

Returns:

- Updated action status
- Audit event ID

### `dismissAgentAction(agentActionId, staffUserId, reason)`

Dismisses an Agent recommendation.

Inputs:

- `agentActionId`
- `staffUserId`
- Optional reason

Returns:

- Updated action status
- Audit event ID

## Safety and Traceability

### `getAgentReviewSources(reviewId)`

Returns the portfolio facts used by the Agent for a review.

Inputs:

- `reviewId`

Returns:

- Trip records referenced
- Approval records referenced
- Readiness signals referenced
- Timestamps for source data

### `recordAgentFeedback(agentActionId, staffUserId, feedback)`

Stores staff feedback on Agent recommendations.

Feedback examples:

- Helpful
- Not relevant
- Wrong priority
- Wrong tone
- Missing context

Returns:

- Feedback ID
- Updated quality signal
