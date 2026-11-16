class Authenticator:
    """Returns a fixed non-secret string so a test can assert the publisher
    passed SOMETHING as a bearer token without any real credential existing."""
    def get_access_token(self):
        return "stub-token-not-a-secret"
