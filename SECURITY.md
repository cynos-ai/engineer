# Security policy

## Reporting a vulnerability

Please do not open a public issue for an exploitable vulnerability or include
credentials, tokens, cookies, private URLs, or personal data in a report.

Use GitHub's private vulnerability reporting feature when it is enabled for the
repository. If it is not available, contact the maintainer using the address in
`package.json` and include only the minimum reproducible details needed to
triage the issue.

## Supported versions

The latest release on the default branch receives security fixes. Older releases
may be unsupported; report the affected package name and version so the impact
can be assessed.

## Scope

Relevant reports include credential exposure, unsafe URL or browser handling,
remote code execution, dependency vulnerabilities that affect runtime behavior,
and accidental disclosure of private data. Never test against systems you do
not own or have permission to assess.
