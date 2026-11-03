/** Returns the local data-use page. The desktop prototype has no hosted policy service. */
export function getAnalyticsPrivacyPolicyUrl(_locale?: string): string {
  return 'http://127.0.0.1:3850/privacy.html'
}
