# Vulnerability reporting

Do not disclose exploitable financial integrity or data exposure issues in public issues. Use GitHub private vulnerability reporting for `B42y/b42y-core`. Maintainers should reproduce with a minimal test and coordinate a fix before disclosure. Node 22.18+ and 24.11+ are supported for tooling; Node 24 is used in CI.

Repository administrators should enable GitHub secret scanning and push protection. The release workflow publishes with its scoped `GITHUB_TOKEN`; do not commit registry credentials to source control.
