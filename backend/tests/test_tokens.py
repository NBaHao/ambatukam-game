from app.services import tokens


def test_roundtrip():
    s = tokens.new_session("single", 20, 1_000)
    assert tokens.verify("k", tokens.sign("k", s)) == s


def test_wrong_secret_or_tampered_body():
    token = tokens.sign("k", tokens.new_session("single", 20, 1_000))
    assert tokens.verify("other", token) is None
    sig = token.split(".")[1]
    forged = tokens.sign("x", tokens.new_session("single", 10, 1_000)).split(".")[0]
    assert tokens.verify("k", f"{forged}.{sig}") is None


def test_garbage():
    for t in ["", ".", "abc", "a.b", "!!!.???"]:
        assert tokens.verify("k", t) is None


def test_invalid_duration_in_signed_payload():
    assert tokens.verify("k", tokens.sign("k", tokens.Session("single", 15, 1_000, "n"))) is None
