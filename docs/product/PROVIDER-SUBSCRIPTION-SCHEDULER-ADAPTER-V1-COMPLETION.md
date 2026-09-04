# Provider Subscription + Scheduler Adapter V1 Completion

Final branch state after temporary-head cleanup.

The product now has persisted provider subscription lifecycle control, provider-specific subscription adapter contracts, expiration-window detection, and an external scheduler registration bridge that feeds resolved occurrences into the existing schedule source.

No live provider subscription API execution or embedded cron evaluation is claimed.
