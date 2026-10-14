# Contributing to Enthalix

Thank you for your interest. Feedback, bug reports and code are all welcome.

## Feedback and bug reports

Open an [issue](https://github.com/Enthalix-llc/enthalix/issues). For bug
reports, please include:

- what you did, what you expected, and what happened instead;
- your operating system and EnergyPlus version;
- if you can share it, the IFC file that caused the problem. Remove anything
  confidential first: client names, addresses, or project details.

## Contributing code

Enthalix is licensed under the [Apache License 2.0](LICENSE). By contributing,
you agree that your contribution is licensed under the same terms (section 5
of the licence).

### Sign off your commits (DCO)

Every commit must be signed off under the
[Developer Certificate of Origin](https://developercertificate.org/) (DCO).
The sign-off is your statement that you wrote the change, or otherwise have the
right to submit it under the project's licence.

Add the sign-off by committing with `-s`:

```bash
git commit -s -m "Fix zone area calculation for sloped roofs"
```

This adds a line to the commit message:

```
Signed-off-by: Your Name <you@example.com>
```

Use your real name. Pull requests with unsigned commits can't be merged.

### Before you open a pull request

- For anything larger than a small fix, open an issue first so we can agree on
  the approach.
- Don't copy code from projects under licences that are incompatible with
  Apache-2.0, such as GPL-2.0-only.
- Don't include data you can't redistribute, such as copyrighted standards
  tables, manufacturer databases, or weather files without a clear licence.

## Code of conduct

Be respectful and constructive. The maintainers may remove comments or block
users who are abusive.
