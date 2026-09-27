# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately through GitHub's private
vulnerability reporting: on this repository, open the **Security** tab
and choose **Report a vulnerability**. Please do not open a public issue,
pull request or discussion for a suspected vulnerability.

A useful report includes the affected file or tool, the input that
triggers the problem, what you observed, and what you expected. If the
report involves a Todoist token, use a throwaway token or redact it;
never send a live credential.

## Before you report

Some limits are known and documented, and are not new findings:

- `README.md`, "What this server does not defend against", lists what
  this server does not attempt to defend against, such as plain-English
  prompt injection and a compromised orchestrator.
- `docs/SPEC.md` section 10 lists the confirmed open defects (D-4 and
  D-13 to D-22), with how each was reproduced and what would fix it.

A report that shows one of these is worse than recorded, or reaches
further than the spec says, is welcome.

## Supported versions

Only the current `main` branch is supported. There are no released
versions to backport fixes to.
