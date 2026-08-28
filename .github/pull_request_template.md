## Summary

Describe the user problem and the smallest change that solves it.

## Release note

<!--
Write one public, user-facing sentence at or below 500 characters.
For skip-changelog, write "Not applicable:" followed by the reason.
-->

## Version impact

<!-- Select exactly one. The release maintainer decides the final combined version. -->

- [ ] major
- [ ] minor
- [ ] patch
- [ ] none

## Provenance

- AI assistance used: yes | no
- AI agent or harness:
- Human reviewer:
- Kledo evidence source: public documentation | synthetic fixture | sanitized live probe | not applicable

## Safety and compatibility

Explain the read-only boundary, privacy impact, bounds, pagination, error behavior,
and backward compatibility.

## Validation

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Contract and fixture tests cover interface or upstream changes.
- [ ] The diff contains no credentials, real tenant data, private identifiers, or local paths.
- [ ] The diff and pull request text contain no Unicode em dash characters.
- [ ] Documentation and capability tables are updated when behavior changes.
- [ ] The narrowest release-note label is applied, or `skip-changelog` explains why no note is needed.
