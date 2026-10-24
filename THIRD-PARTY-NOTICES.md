# Third-party notices

No app artifact or font is bundled yet: `packages/lina_app` and
`packages/lina_design` are reserved for #6 and #5. The in-process app runtime
inventory in `scripts/verify/licenses.json` is therefore empty. When either
component becomes active, its complete runtime dependency closure and fonts
must enter that inventory with exact reviewed versions and full notices before
the gate passes. Development tooling below is not shipped with the app.

## Flutter SDK

The gate uses Flutter **3.47.8 stable**, framework revision
`737ba8f885dc774b53b442759999a312c9461e4e`, with Dart 3.13.7.
Flutter framework and `flutter_test` are BSD-3-Clause, copyright The Flutter
Authors. Source: https://github.com/flutter/flutter/tree/737ba8f885dc774b53b442759999a312c9461e4e

The `sky_engine` SDK package contains the engine's combined third-party license
file, not one license that can be inferred from the first component. It is used
only by headless tooling here. Any app release must preserve Flutter's generated
license registry and engine notices and review the actual native artifact;
this notice does not claim an engine redistribution review has been completed.

Copyright 2014 The Flutter Authors. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above
      copyright notice, this list of conditions and the following
      disclaimer in the documentation and/or other materials provided
      with the distribution.
    * Neither the name of Google Inc. nor the names of its
      contributors may be used to endorse or promote products derived
      from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


## Development tooling inventory

The locked graph contains 22 hosted packages and 3 SDK packages. Hosted license
files were inspected at these exact installed versions. No upstream source is
vendored. SDK inputs are covered above. Apache-2.0 packages below have no separate
NOTICE file in their Pub archives. Their upstream license texts remain in the
Pub packages; the tooling is never installed for an app user.

| Hosted package | Exact version | License | Source/license |
| --- | --- | --- | --- |
| async | 2.13.1 | BSD-3-Clause | https://pub.dev/packages/async/versions/2.13.1/license |
| boolean_selector | 2.1.2 | BSD-3-Clause | https://pub.dev/packages/boolean_selector/versions/2.1.2/license |
| characters | 1.4.1 | BSD-3-Clause | https://pub.dev/packages/characters/versions/1.4.1/license |
| clock | 1.1.3 | Apache-2.0 | https://pub.dev/packages/clock/versions/1.1.3/license |
| collection | 1.19.1 | BSD-3-Clause | https://pub.dev/packages/collection/versions/1.19.1/license |
| fake_async | 1.3.3 | Apache-2.0 | https://pub.dev/packages/fake_async/versions/1.3.3/license |
| leak_tracker | 11.0.2 | BSD-3-Clause | https://pub.dev/packages/leak_tracker/versions/11.0.2/license |
| leak_tracker_flutter_testing | 3.0.10 | BSD-3-Clause | https://pub.dev/packages/leak_tracker_flutter_testing/versions/3.0.10/license |
| leak_tracker_testing | 3.0.2 | BSD-3-Clause | https://pub.dev/packages/leak_tracker_testing/versions/3.0.2/license |
| matcher | 0.12.20 | BSD-3-Clause | https://pub.dev/packages/matcher/versions/0.12.20/license |
| material_color_utilities | 0.13.0 | Apache-2.0 | https://pub.dev/packages/material_color_utilities/versions/0.13.0/license |
| meta | 1.19.0 | BSD-3-Clause | https://pub.dev/packages/meta/versions/1.19.0/license |
| path | 1.9.1 | BSD-3-Clause | https://pub.dev/packages/path/versions/1.9.1/license |
| source_span | 1.10.2 | BSD-3-Clause | https://pub.dev/packages/source_span/versions/1.10.2/license |
| stack_trace | 1.12.2 | BSD-3-Clause | https://pub.dev/packages/stack_trace/versions/1.12.2/license |
| stream_channel | 2.1.4 | BSD-3-Clause | https://pub.dev/packages/stream_channel/versions/2.1.4/license |
| string_scanner | 1.4.1 | BSD-3-Clause | https://pub.dev/packages/string_scanner/versions/1.4.1/license |
| term_glyph | 1.2.2 | BSD-3-Clause | https://pub.dev/packages/term_glyph/versions/1.2.2/license |
| test_api | 0.7.12 | BSD-3-Clause | https://pub.dev/packages/test_api/versions/0.7.12/license |
| vector_math | 2.4.3 | BSD-3-Clause | https://pub.dev/packages/vector_math/versions/2.4.3/license |
| vm_service | 15.4.0 | BSD-3-Clause | https://pub.dev/packages/vm_service/versions/15.4.0/license |
| yaml | 3.1.3 | MIT | https://pub.dev/packages/yaml/versions/3.1.3/license |

## yaml

The only direct hosted tooling dependency is yaml 3.1.3 (MIT). It parses
manifests without executing YAML tags. Its runtime closure is collection,
source_span, string_scanner, path and term_glyph (BSD-3-Clause).

Copyright (c) 2014, the Dart project authors.
Copyright (c) 2006, Kirill Simonov.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


## Pretendard

Planned font, **not bundled in this change**. Reviewed upstream v1.3.9:
https://github.com/orioncactus/pretendard/tree/v1.3.9

License: SIL Open Font License 1.1 (`OFL-1.1`), compatible with bundling in an
Apache-2.0 application while the font remains under OFL. Preserve this copyright
and license with the font. Do not sell the font alone or use the reserved name
for a modified font without permission. #5 must pin and review the actual font
files/version it chooses and add them to the font inventory.

Copyright (c) 2021, Kil Hyung-jin (https://github.com/orioncactus/pretendard),
with Reserved Font Name Pretendard.

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
