"""
Integration test configuration.

These tests require the API service to be running.
Run with: pytest tests/integration/ -v
"""

import pytest


def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line(
        "markers", "integration: mark test as an integration test (requires running service)"
    )


def pytest_collection_modifyitems(config, items):
    """Skip integration tests unless the service is running."""
    skip_integration = pytest.mark.skip(reason="Integration test - requires running service")
    
    for item in items:
        if "integration" in item.keywords:
            # Integration tests will be skipped automatically if service unavailable
            # via the fixture
            pass
