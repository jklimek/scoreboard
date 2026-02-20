from v2.services.reactive_poller.rate_controller import AdaptiveRateController


def test_rate_controller_backoff_and_recovery() -> None:
    controller = AdaptiveRateController(
        base_interval=1.0,
        min_interval=0.5,
        max_interval=5.0,
        healthy_streak_for_recovery=2,
    )

    assert controller.current_interval == 1.0

    controller.on_error()
    assert controller.current_interval > 1.0
    error_interval = controller.current_interval

    controller.on_success()
    assert controller.current_interval == error_interval
    controller.on_success()
    assert controller.current_interval < error_interval


def test_rate_controller_throttle() -> None:
    controller = AdaptiveRateController(
        base_interval=1.0,
        min_interval=0.5,
        max_interval=4.0,
        healthy_streak_for_recovery=3,
    )
    controller.on_throttled()
    assert 1.0 < controller.current_interval <= 4.0
