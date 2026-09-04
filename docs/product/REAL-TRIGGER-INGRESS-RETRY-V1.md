# NaIA Real Trigger Ingress and Retry V1

Status: COMPLETE

This block turns the trigger-delivery contract into a real HTTP ingress boundary without moving scheduling or durable execution into NaIA Core.

Delivered:
- authenticated trigger ingress abstraction
- bearer-token authentication
- HMAC-SHA256 authentication over the raw request body
- HTTP `POST /triggers` server adapter using Node `http`
- request-size protection and JSON parsing boundary
- retry policy with max attempts, exponential backoff, and retryability predicate
- dead-letter store contract
- retry dispatcher that preserves the existing trigger runtime/idempotency boundary
- tests for unauthorized ingress, authenticated delivery, HMAC validation, retry/backoff, terminal dead-letter, and live HTTP ingress

Safety and architecture boundaries:
- ingress never invokes a capability directly
- ingress dispatches into the existing trigger runtime
- accepted deliveries still create proposals in `WAITING_CONFIRMATION`
- connection and scoped write approval remain downstream gates
- scheduler remains external
- durable execution/chassis remains unselected

Maturity gaps:
- production TLS termination
- rate limiting
- IP/network policy
- persistent dead-letter store
- retry classification taxonomy
- scheduler adapter
- webhook-provider-specific signature adapters
- distributed retry coordination

State:

`REAL_HTTP_TRIGGER_INGRESS_V1 = COMPLETE`

`INGRESS_AUTH_BEARER_V1 = COMPLETE`

`INGRESS_AUTH_HMAC_V1 = COMPLETE`

`RETRY_BACKOFF_POLICY_V1 = COMPLETE`

`DEAD_LETTER_CONTRACT_V1 = COMPLETE`

`PRODUCTION_EDGE_HARDENING = NOT_IMPLEMENTED`

`EMBEDDED_SCHEDULER = NOT_IMPLEMENTED`

`DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`

`CHASSIS_WINNER = NOT_SELECTED`
