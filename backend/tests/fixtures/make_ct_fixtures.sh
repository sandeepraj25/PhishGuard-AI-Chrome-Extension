#!/usr/bin/env bash
# Generates self-signed test certificates (DER) for the CT worker tests. Fictional .test names only.
set -euo pipefail
cd "$(dirname "$0")/ct"
make_cert() {  # name, SAN list
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout /dev/null -days 90 \
    -subj "/CN=$2" -addext "subjectAltName=$3" -outform DER -out "$1.der" 2>/dev/null
}
make_cert brand_host   examplebank-login.test     "DNS:examplebank-login.test,DNS:www.examplebank-login.test"
make_cert homoglyph    examp1ebank.test           "DNS:examp1ebank.test"
make_cert punycode     xn--exmplebank-0qi.test    "DNS:xn--exmplebank-0qi.test"
make_cert wildcard     "*.secure-examplebank.test" "DNS:*.secure-examplebank.test"
make_cert neutral      cedarlabs.test             "DNS:cedarlabs.test,DNS:www.cedarlabs.test"
ls -l
