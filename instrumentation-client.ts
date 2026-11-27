import posthog from "posthog-js";

// Analytics is opt-in and sent only to the deployment operator's own endpoint.
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
if (key && host) {
  posthog.init(key, { api_host: host, capture_pageview: "history_change", disable_surveys: true });
}
