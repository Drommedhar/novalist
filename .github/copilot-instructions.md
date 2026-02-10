# Copilot Instructions

Before responding that work is finished, you MUST run `npm run verify` and confirm it completed successfully.
Warnings are strictly disallowed; resolve all warnings before considering work finished.
Do NOT use `eslint-disable` comments to suppress lint errors; fix the underlying issue instead.

## README Maintenance

When adding, removing, or changing user-facing features, update `README.md` to reflect the current state. Follow these style rules:

- Keep the logo (`images/novalist.png`) at the top. Do not add other images or screenshots.
- Open with a single short paragraph summarizing the plugin.
- **Getting Started** section explains the startup wizard and project initialization.
- **Features** section has one `###` subsection per feature. Each subsection starts with a brief description of what the feature does, then lists concrete details in short bullet points or compact prose. No fluff — every sentence should convey useful information.
- Use inline code for UI labels, keyboard shortcuts, and token examples. Use bold for emphasis sparingly.
- **Settings** table lists every user-configurable setting with columns: Setting, Description, Default.
- **Commands** table lists every command palette entry with columns: Command, Description.
- **Internationalization** section is a single short paragraph.
- **Support Development** section with the PayPal donate button stays at the bottom, followed by the tagline.
- Tone is direct, factual, and concise. No marketing language, no exclamation marks, no filler.
