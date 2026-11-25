# Third-party notices

Sherlock Timeline installs its dependencies from the versions in `pnpm-lock.yaml`. The packages include their own copyright and licence notices. Run `pnpm licenses list --prod` after installation to inspect the runtime inventory for your platform.

| Component | Attribution and licence |
| --- | --- |
| Icons | Lucide contributors (ISC) and Feather-derived icons by Cole Bemis (MIT). [Lucide and Feather notices](public/licenses/lucide.txt). |
| Interface fonts | Geist Sans and Geist Mono by Vercel and Basement Studio. [Geist font licence](public/licenses/geist.txt). |
| PDF import | Mozilla PDF.js (Apache-2.0). Its character maps and bundled fonts carry separate notices in `pdfjs-dist/cmaps/LICENSE` and `pdfjs-dist/standard_fonts/LICENSE_*`. |
| Browser compatibility data | Can I Use data, distributed through `caniuse-lite` under CC BY 4.0. See the installed package's licence and attribution. |
| Image processing | Sharp (Apache-2.0) uses a platform-specific libvips distribution (LGPL-3.0-or-later). Its package includes notices for the accompanying native libraries. |

When redistributing a built application or container, include the applicable dependency licences, attributions and notices with the distribution. The lockfile records dependencies for multiple platforms. The installed inventory reflects the platform used to run the command.
