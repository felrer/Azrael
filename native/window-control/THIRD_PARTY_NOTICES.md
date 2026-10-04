# Native Window Control Third-Party Notices

This file covers all 39 registry package/version entries in the native window-control Cargo.lock graph, including build-time/procedural-macro dependencies and Windows target support packages. The Azrael package itself is excluded. Sources are the locally resolved crate distributions identified by `cargo metadata --locked --offline --format-version 1`; registry source is `registry+https://github.com/rust-lang/crates.io-index`. Crate links identify the exact upstream distribution version.

For packages offering MIT or Apache-2.0 alternatives, this distribution selects MIT. Where other alternatives are offered, MIT is likewise selected. unicode-ident additionally requires Unicode-3.0; zlib-rs is retained under Zlib. The declared expressions below come from crate metadata, including legacy `MIT/Apache-2.0` notation. No new copyright attributions have been supplied. Selected license texts and additional root NOTICE files are retained verbatim from the source distributions. Identical byte-for-byte texts are retained once and shared by reference; SHA256 values identify the original text bytes. miniz_oxide also retains its root LICENSE attribution text.

| Crate/source distribution | Version | Declared license expression | Selected license | Retained source text |
| --- | --- | --- | --- | --- |
| [adler2](https://crates.io/crates/adler2/2.0.1) | 2.0.1 | `0BSD OR MIT OR Apache-2.0` | `MIT` | [LICENSE-MIT (L01)](#license-text-l01) |
| [base64](https://crates.io/crates/base64/0.22.1) | 0.22.1 | `MIT OR Apache-2.0` | `MIT` | [LICENSE-MIT (L02)](#license-text-l02) |
| [bitflags](https://crates.io/crates/bitflags/1.3.2) | 1.3.2 | `MIT/Apache-2.0` | `MIT` | [LICENSE-MIT (L03)](#license-text-l03) |
| [cfg-if](https://crates.io/crates/cfg-if/1.0.5) | 1.0.5 | `MIT OR Apache-2.0` | `MIT` | [LICENSE-MIT (L04)](#license-text-l04) |
| [crc32fast](https://crates.io/crates/crc32fast/1.5.2) | 1.5.2 | `MIT OR Apache-2.0` | `MIT` | [LICENSE-MIT (L05)](#license-text-l05) |
| [fdeflate](https://crates.io/crates/fdeflate/0.3.7) | 0.3.7 | `MIT OR Apache-2.0` | `MIT` | [LICENSE-MIT (L06)](#license-text-l06) |
| [flate2](https://crates.io/crates/flate2/1.1.10) | 1.1.10 | `MIT OR Apache-2.0` | `MIT` | [LICENSE-MIT (L07)](#license-text-l07) |
| [itoa](https://crates.io/crates/itoa/1.0.18) | 1.0.18 | `MIT OR Apache-2.0` | `MIT` | [LICENSE-MIT (L01)](#license-text-l01) |
| [memchr](https://crates.io/crates/memchr/2.8.3) | 2.8.3 | `Unlicense OR MIT` | `MIT` | [LICENSE-MIT (L08)](#license-text-l08) |
| [miniz_oxide](https://crates.io/crates/miniz_oxide/0.8.9) | 0.8.9 | `MIT OR Zlib OR Apache-2.0` | `MIT` | [LICENSE-MIT.md (L09)](#license-text-l09); [LICENSE (L10)](#license-text-l10) |
| [miniz_oxide](https://crates.io/crates/miniz_oxide/0.9.1) | 0.9.1 | `MIT OR Zlib OR Apache-2.0` | `MIT` | [LICENSE-MIT.md (L09)](#license-text-l09); [LICENSE (L10)](#license-text-l10) |
| [png](https://crates.io/crates/png/0.17.16) | 0.17.16 | `MIT OR Apache-2.0` | `MIT` | [LICENSE-MIT (L11)](#license-text-l11) |
| [proc-macro2](https://crates.io/crates/proc-macro2/1.0.107) | 1.0.107 | `MIT OR Apache-2.0` | `MIT` | [LICENSE-MIT (L01)](#license-text-l01) |
| [quote](https://crates.io/crates/quote/1.0.47) | 1.0.47 | `MIT OR Apache-2.0` | `MIT` | [LICENSE-MIT (L01)](#license-text-l01) |
| [serde_core](https://crates.io/crates/serde_core/1.0.229) | 1.0.229 | `MIT OR Apache-2.0` | `MIT` | [LICENSE-MIT (L01)](#license-text-l01) |
| [serde_derive](https://crates.io/crates/serde_derive/1.0.229) | 1.0.229 | `MIT OR Apache-2.0` | `MIT` | [LICENSE-MIT (L01)](#license-text-l01) |
| [serde_json](https://crates.io/crates/serde_json/1.0.151) | 1.0.151 | `MIT OR Apache-2.0` | `MIT` | [LICENSE-MIT (L01)](#license-text-l01) |
| [serde](https://crates.io/crates/serde/1.0.229) | 1.0.229 | `MIT OR Apache-2.0` | `MIT` | [LICENSE-MIT (L01)](#license-text-l01) |
| [simd-adler32](https://crates.io/crates/simd-adler32/0.3.10) | 0.3.10 | `MIT` | `MIT` | [LICENSE.md (L12)](#license-text-l12) |
| [syn](https://crates.io/crates/syn/2.0.119) | 2.0.119 | `MIT OR Apache-2.0` | `MIT` | [LICENSE-MIT (L01)](#license-text-l01) |
| [syn](https://crates.io/crates/syn/3.0.6) | 3.0.6 | `MIT OR Apache-2.0` | `MIT` | [LICENSE-MIT (L01)](#license-text-l01) |
| [unicode-ident](https://crates.io/crates/unicode-ident/1.0.26) | 1.0.26 | `(MIT OR Apache-2.0) AND Unicode-3.0` | `MIT AND Unicode-3.0` | [LICENSE-MIT (L01)](#license-text-l01); [LICENSE-UNICODE (L13)](#license-text-l13) |
| [windows_aarch64_gnullvm](https://crates.io/crates/windows_aarch64_gnullvm/0.52.6) | 0.52.6 | `MIT OR Apache-2.0` | `MIT` | [license-mit (L14)](#license-text-l14) |
| [windows_aarch64_msvc](https://crates.io/crates/windows_aarch64_msvc/0.52.6) | 0.52.6 | `MIT OR Apache-2.0` | `MIT` | [license-mit (L14)](#license-text-l14) |
| [windows_i686_gnu](https://crates.io/crates/windows_i686_gnu/0.52.6) | 0.52.6 | `MIT OR Apache-2.0` | `MIT` | [license-mit (L14)](#license-text-l14) |
| [windows_i686_gnullvm](https://crates.io/crates/windows_i686_gnullvm/0.52.6) | 0.52.6 | `MIT OR Apache-2.0` | `MIT` | [license-mit (L14)](#license-text-l14) |
| [windows_i686_msvc](https://crates.io/crates/windows_i686_msvc/0.52.6) | 0.52.6 | `MIT OR Apache-2.0` | `MIT` | [license-mit (L14)](#license-text-l14) |
| [windows_x86_64_gnu](https://crates.io/crates/windows_x86_64_gnu/0.52.6) | 0.52.6 | `MIT OR Apache-2.0` | `MIT` | [license-mit (L14)](#license-text-l14) |
| [windows_x86_64_gnullvm](https://crates.io/crates/windows_x86_64_gnullvm/0.52.6) | 0.52.6 | `MIT OR Apache-2.0` | `MIT` | [license-mit (L14)](#license-text-l14) |
| [windows_x86_64_msvc](https://crates.io/crates/windows_x86_64_msvc/0.52.6) | 0.52.6 | `MIT OR Apache-2.0` | `MIT` | [license-mit (L14)](#license-text-l14) |
| [windows-core](https://crates.io/crates/windows-core/0.58.0) | 0.58.0 | `MIT OR Apache-2.0` | `MIT` | [license-mit (L14)](#license-text-l14) |
| [windows-implement](https://crates.io/crates/windows-implement/0.58.0) | 0.58.0 | `MIT OR Apache-2.0` | `MIT` | [license-mit (L14)](#license-text-l14) |
| [windows-interface](https://crates.io/crates/windows-interface/0.58.0) | 0.58.0 | `MIT OR Apache-2.0` | `MIT` | [license-mit (L14)](#license-text-l14) |
| [windows-result](https://crates.io/crates/windows-result/0.2.0) | 0.2.0 | `MIT OR Apache-2.0` | `MIT` | [license-mit (L14)](#license-text-l14) |
| [windows-strings](https://crates.io/crates/windows-strings/0.1.0) | 0.1.0 | `MIT OR Apache-2.0` | `MIT` | [license-mit (L14)](#license-text-l14) |
| [windows-targets](https://crates.io/crates/windows-targets/0.52.6) | 0.52.6 | `MIT OR Apache-2.0` | `MIT` | [license-mit (L14)](#license-text-l14) |
| [windows](https://crates.io/crates/windows/0.58.0) | 0.58.0 | `MIT OR Apache-2.0` | `MIT` | [license-mit (L14)](#license-text-l14) |
| [zlib-rs](https://crates.io/crates/zlib-rs/0.6.8) | 0.6.8 | `Zlib` | `Zlib` | [LICENSE (L15)](#license-text-l15) |
| [zmij](https://crates.io/crates/zmij/1.0.23) | 1.0.23 | `MIT` | `MIT` | [LICENSE-MIT (L01)](#license-text-l01) |

## License text L01

Source files: `adler2-2.0.1/LICENSE-MIT`, `itoa-1.0.18/LICENSE-MIT`, `proc-macro2-1.0.107/LICENSE-MIT`, `quote-1.0.47/LICENSE-MIT`, `serde_core-1.0.229/LICENSE-MIT`, `serde_derive-1.0.229/LICENSE-MIT`, `serde_json-1.0.151/LICENSE-MIT`, `serde-1.0.229/LICENSE-MIT`, `syn-2.0.119/LICENSE-MIT`, `syn-3.0.6/LICENSE-MIT`, `unicode-ident-1.0.26/LICENSE-MIT`, `zmij-1.0.23/LICENSE-MIT`.

Original text SHA256: `23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3`.

```text
Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

## License text L02

Source files: `base64-0.22.1/LICENSE-MIT`.

Original text SHA256: `0dd882e53de11566d50f8e8e2d5a651bcf3fabee4987d70f306233cf39094ba7`.

```text
The MIT License (MIT)

Copyright (c) 2015 Alice Maz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## License text L03

Source files: `bitflags-1.3.2/LICENSE-MIT`.

Original text SHA256: `6485b8ed310d3f0340bf1ad1f47645069ce4069dcc6bb46c7d5c6faf41de1fdb`.

```text
Copyright (c) 2014 The Rust Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

## License text L04

Source files: `cfg-if-1.0.5/LICENSE-MIT`.

Original text SHA256: `378f5840b258e2779c39418f3f2d7b2ba96f1c7917dd6be0713f88305dbda397`.

```text
Copyright (c) 2014 Alex Crichton

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

## License text L05

Source files: `crc32fast-1.5.2/LICENSE-MIT`.

Original text SHA256: `61d383b05b87d78f94d2937e2580cce47226d17823c0430fbcad09596537efcf`.

```text
MIT License

Copyright (c) 2018 Sam Rijs, Alex Crichton and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## License text L06

Source files: `fdeflate-0.3.7/LICENSE-MIT`.

Original text SHA256: `c77a4cf9da729987d0fe7ccd811e3bd27393914ddf3d23467c18cc22954513b3`.

```text
MIT License

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

## License text L07

Source files: `flate2-1.1.10/LICENSE-MIT`.

Original text SHA256: `025436edff4cfcdde17a5811fdea78892d8482efd1abdec5a17872d07a4f2112`.

```text
Copyright (c) 2014-2026 Alex Crichton

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

## License text L08

Source files: `memchr-2.8.3/LICENSE-MIT`.

Original text SHA256: `0f96a83840e146e43c0ec96a22ec1f392e0680e6c1226e6f3ba87e0740af850f`.

```text
The MIT License (MIT)

Copyright (c) 2015 Andrew Gallant

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## License text L09

Source files: `miniz_oxide-0.8.9/LICENSE-MIT.md`, `miniz_oxide-0.9.1/LICENSE-MIT.md`.

Original text SHA256: `799e9ca9d179295ef372f25d3769cdda7d25bb2668add6a6a1e22d1e4c678b8d`.

```text
MIT License

Copyright 2013-2014 RAD Game Tools and Valve Software
Copyright 2010-2014 Rich Geldreich and Tenacious Software LLC
Copyright (c) 2017 Frommi
Copyright (c) 2017-2024 oyvindln

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## License text L10

Source files: `miniz_oxide-0.8.9/LICENSE`, `miniz_oxide-0.9.1/LICENSE`.

Original text SHA256: `4108245a1f2df9d4e94df8abed5b4ba0759bb2f9b40a6b939f1be141077ae50b`.

```text
MIT License

Copyright 2013-2014 RAD Game Tools and Valve Software
Copyright 2010-2014 Rich Geldreich and Tenacious Software LLC
Copyright (c) 2017 Frommi
Copyright (c) 2017-2024 oyvindln


Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## License text L11

Source files: `png-0.17.16/LICENSE-MIT`.

Original text SHA256: `eaf40297c75da471f7cda1f3458e8d91b4b2ec866e609527a13acfa93b638652`.

```text
Copyright (c) 2015 nwin

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

## License text L12

Source files: `simd-adler32-0.3.10/LICENSE.md`.

Original text SHA256: `42a35170233e83e18856792e748de4c1ce4a63b2afce9a370c89ef3fe23f9f2d`.

```text
MIT License

Copyright (c) [2021] [Marvin Countryman]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## License text L13

Source files: `unicode-ident-1.0.26/LICENSE-UNICODE`.

Original text SHA256: `f7db81051789b729fea528a63ec4c938fdcb93d9d61d97dc8cc2e9df6d47f2a1`.

```text
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2023 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.
```

## License text L14

Source files: `windows_aarch64_gnullvm-0.52.6/license-mit`, `windows_aarch64_msvc-0.52.6/license-mit`, `windows_i686_gnu-0.52.6/license-mit`, `windows_i686_gnullvm-0.52.6/license-mit`, `windows_i686_msvc-0.52.6/license-mit`, `windows_x86_64_gnu-0.52.6/license-mit`, `windows_x86_64_gnullvm-0.52.6/license-mit`, `windows_x86_64_msvc-0.52.6/license-mit`, `windows-core-0.58.0/license-mit`, `windows-implement-0.58.0/license-mit`, `windows-interface-0.58.0/license-mit`, `windows-result-0.2.0/license-mit`, `windows-strings-0.1.0/license-mit`, `windows-targets-0.52.6/license-mit`, `windows-0.58.0/license-mit`.

Original text SHA256: `c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383`.

```text
    MIT License

    Copyright (c) Microsoft Corporation.

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE
```

## License text L15

Source files: `zlib-rs-0.6.8/LICENSE`.

Original text SHA256: `e72111c52b7d96ebe25348dee19f0744f444d3c95ae6b1ecb6ccaecc5bce05ba`.

```text
(C) 2024 Trifecta Tech Foundation 

This software is provided 'as-is', without any express or implied
warranty. In no event will the authors be held liable for any damages
arising from the use of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it
freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not
   claim that you wrote the original software. If you use this software
   in a product, an acknowledgment in the product documentation would be
   appreciated but is not required.

2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.

3. This notice may not be removed or altered from any source distribution.
```

