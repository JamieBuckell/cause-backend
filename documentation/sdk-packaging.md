# AWS SDK packaging

All v2 services that import `aws-sdk` declare it as a production dependency.
The service lockfiles preserve the existing SDK versions; this change does not
upgrade runtimes or migrate application code to SDK v3.

On 19 November 2026, the eight live hampers functions were repaired with
production dependency files, preserving their deployed application code. Each
previous deployment was backed up, updates used Lambda revision guards, and
verification checked code hashes and safe handler initialization. Deployment
artifacts and verification are in workspace `outputs/hamper-screen-fix-2026-11-19`
and `outputs/remaining-sdk-fixes-2026-11-19` (not committed).

The six services still using older live runtimes (comms, dataMigration, emails,
feedback, organisations and reports) have corrected manifests and lockfiles for
their next deployment. Their live functions were not redeployed as part of this
repair. Production packaging must retain the SDK and its transitive dependencies;
Node.js 18 and newer Lambda runtimes do not supply the `aws-sdk` v2 module.

For future deployments, check the resulting ZIP contains
`node_modules/aws-sdk/lib/aws.js` and cold-load its handler before deployment.
The unit harness mocks AWS dependencies and cannot detect a missing packaged SDK.
