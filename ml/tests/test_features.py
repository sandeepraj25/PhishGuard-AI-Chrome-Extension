import math

import pytest

from phishguard_ml.bloom import BASIS1, BloomFilter, fnv1a64
from phishguard_ml.detmath import det_log2, shannon_entropy
from phishguard_ml.features import FEATURE_NAMES, NUM_FEATURES, default_engine
from phishguard_ml.lookalike import bounded_edit_distance, is_mixed_script, punycode_decode, skeleton_ascii
from phishguard_ml.urlparse import is_ip_host, normalize_url, parse_url

I = {n: i for i, n in enumerate(FEATURE_NAMES)}


def test_feature_count_matches_spec():
    assert NUM_FEATURES == 26


@pytest.mark.parametrize("x", [1e-9, 0.001, 0.1, 0.3, 0.5, 1.0, 1.5, 3.0, 1234.5])
def test_det_log2_close_to_libm(x):
    assert abs(det_log2(x) - math.log2(x)) <= 1e-13 * (1 + abs(math.log2(x)))


def test_entropy():
    assert shannon_entropy("") == 0.0
    assert shannon_entropy("aaaa") == 0.0
    assert abs(shannon_entropy("abcd") - 2.0) < 1e-15


def test_parse_url_components():
    u = parse_url("  HTTPS://user:pw@Login.ExampleBank.test.evil.com.:8443/a/b/?x=1&y=2#frag ")
    assert (u.scheme, u.host, u.port, u.path, u.query, u.has_at) == (
        "https", "login.examplebank.test.evil.com", "8443", "/a/b/", "x=1&y=2", True)
    assert normalize_url("http://a.com/é") == "http://a.com/%C3%A9"


def test_ip_detection():
    assert is_ip_host("192.168.0.1") and is_ip_host("3232235777") and is_ip_host("[::1]")
    assert not is_ip_host("1.2.3") and not is_ip_host("example.com")


def test_psl():
    e = default_engine()
    assert e.psl.registered_domain("a.b.example.co.uk") == "example.co.uk"
    assert e.psl.registered_domain("evil.web.app") == "evil.web.app"
    assert e.psl.registered_domain("axis.bank.in") == "axis.bank.in"
    assert e.psl.registered_domain("x.www.ck") == "www.ck"


def test_punycode_and_scripts():
    assert punycode_decode("mnchen-3ya") == [ord(c) for c in "münchen"]
    assert punycode_decode("99999999999999999") is None
    assert is_mixed_script([ord("p"), 0x430, ord("y")])
    assert skeleton_ascii("paypa1", default_engine().confusables) == "paypal"
    assert skeleton_ascii("rnicrosoft", default_engine().confusables) == "microsoft"


@pytest.mark.parametrize("a,b,d", [("examplebank", "examplebank", 0), ("examp1ebank", "examplebank", 1),
                                    ("kitten", "sitting", 3), ("abc", "abcdef", 3), ("", "ab", 2)])
def test_bounded_edit_distance(a, b, d):
    assert bounded_edit_distance(a, b, 2) == d


def test_brand_features():
    e = default_engine()
    f, d = e.extract("http://examplebank.test.secure-login.xyz/verify/account")
    assert f[I["brand_in_host_not_official"]] == 1.0 and d.kind == "host" and d.brand == "examplebank"
    f, d = e.extract("https://login.examplebank.test/signin")
    assert f[I["brand_in_host_not_official"]] == 0.0 and f[I["min_brand_edit_distance"]] == 3.0
    f, d = e.extract("https://xn--exmplebank-0qi.com/")
    assert f[I["homoglyph_brand_match"]] == 1.0 and f[I["is_mixed_script"]] == 1.0
    assert e.extract("https://groups.example.com/")[0][I["brand_in_host_not_official"]] == 0.0


def test_bloom_shared_vector():
    # Same constants as wasm/tests/core_test.cpp and backend/tests/bloom.test.ts
    assert fnv1a64("a", BASIS1) == 0xAF63DC4C8601EC8C
    bf = BloomFilter.for_capacity(100, 0.001)
    for i in range(100):
        bf.add(f"bad{i}.test")
    back = BloomFilter.deserialize(bf.serialize())
    assert all(f"bad{i}.test" in back for i in range(100))
    assert back.n == 100
