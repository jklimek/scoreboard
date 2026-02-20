class PollerError(RuntimeError):
    """Base poller failure."""


class PollerThrottleError(PollerError):
    """Raised when upstream throttles requests."""
