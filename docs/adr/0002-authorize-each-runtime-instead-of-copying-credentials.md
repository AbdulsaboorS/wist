# Authorize each Runtime instead of copying credentials

Wist will transfer Capability declarations and Setup Plans but never authenticated CLI state or raw credentials. Each Runtime establishes a scoped Connection through the provider's official authorization flow or a trusted remote broker; this adds a visible setup step but preserves revocation, provider policy, and the security boundary required for personal assistants to act safely.
