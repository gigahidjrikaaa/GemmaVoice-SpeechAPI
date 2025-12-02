"""
Unit tests for application settings and configuration.

Tests cover Settings class, environment variable parsing,
default values, and validation.
"""

import os
from typing import Generator
from unittest.mock import patch

import pytest


# ============================================================================
# Settings Default Values Tests
# ============================================================================

class TestSettingsDefaults:
    """Test default values in Settings."""

    def test_api_title_has_default(self) -> None:
        """API title has a default value."""
        # Import here to use get_settings which handles env properly
        from app.config.settings import get_settings
        
        settings = get_settings()
        assert settings.api_title is not None
        assert len(settings.api_title) > 0

    def test_api_version_has_default(self) -> None:
        """API version has a default value."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        assert settings.api_version is not None

    def test_log_level_has_valid_value(self) -> None:
        """Log level has a valid value."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        assert settings.log_level in valid_levels

    def test_security_fields_exist(self) -> None:
        """Security settings fields exist."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        assert hasattr(settings, "api_key_enabled")
        assert hasattr(settings, "rate_limit_enabled")
        assert hasattr(settings, "api_key_header_name")

    def test_llm_fields_exist(self) -> None:
        """LLM settings fields exist."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        assert hasattr(settings, "llm_context_size")
        assert hasattr(settings, "llm_gpu_layers")
        assert hasattr(settings, "llm_repo_id")

    def test_documentation_fields_exist(self) -> None:
        """Documentation settings fields exist."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        assert hasattr(settings, "docs_url")
        assert hasattr(settings, "openapi_url")


# ============================================================================
# Settings Model Config Tests
# ============================================================================

class TestSettingsModelConfig:
    """Test Settings Pydantic configuration."""

    def test_settings_is_pydantic_model(self) -> None:
        """Settings is a valid Pydantic model."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        assert hasattr(settings, "model_dump")

    def test_env_file_encoding(self) -> None:
        """Settings uses UTF-8 for .env file."""
        from app.config.settings import Settings
        
        config = Settings.model_config
        assert config.get("env_file_encoding") == "utf-8"

    def test_extra_fields_ignored(self) -> None:
        """Extra fields are configured to be ignored."""
        from app.config.settings import Settings
        
        config = Settings.model_config
        assert config.get("extra") == "ignore"


# ============================================================================
# get_settings Tests
# ============================================================================

class TestGetSettings:
    """Test get_settings function."""

    def test_returns_settings_instance(self) -> None:
        """get_settings returns a Settings instance."""
        from app.config.settings import Settings, get_settings
        
        settings = get_settings()
        assert isinstance(settings, Settings)

    def test_settings_have_required_fields(self) -> None:
        """Returned settings have required fields."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        
        # Core fields
        assert hasattr(settings, "api_title")
        assert hasattr(settings, "api_version")
        assert hasattr(settings, "log_level")
        
        # Security fields
        assert hasattr(settings, "api_key_enabled")
        assert hasattr(settings, "rate_limit_enabled")

    def test_get_settings_caching(self) -> None:
        """get_settings returns cached instance."""
        from app.config.settings import get_settings
        
        settings1 = get_settings()
        settings2 = get_settings()
        
        # Both should be the same object due to lru_cache
        assert settings1 is settings2


# ============================================================================
# Settings Serialization Tests
# ============================================================================

class TestSettingsSerialization:
    """Test Settings serialization."""

    def test_model_dump(self) -> None:
        """Settings can be dumped to dict."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        data = settings.model_dump()
        
        assert isinstance(data, dict)
        assert "api_title" in data
        assert "log_level" in data

    def test_dump_contains_expected_keys(self) -> None:
        """Dump contains expected configuration keys."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        data = settings.model_dump()
        
        expected_keys = [
            "api_title",
            "api_version",
            "log_level",
            "api_key_enabled",
            "rate_limit_enabled",
        ]
        
        for key in expected_keys:
            assert key in data, f"Missing key: {key}"


# ============================================================================
# Settings Field Types Tests
# ============================================================================

class TestSettingsFieldTypes:
    """Test Settings field type validation."""

    def test_boolean_fields_are_bool(self) -> None:
        """Boolean settings are actual booleans."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        
        assert isinstance(settings.api_key_enabled, bool)
        assert isinstance(settings.rate_limit_enabled, bool)

    def test_integer_fields_are_int(self) -> None:
        """Integer settings are actual integers."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        
        assert isinstance(settings.rate_limit_requests, int)
        assert isinstance(settings.llm_context_size, int)

    def test_string_fields_are_str(self) -> None:
        """String settings are actual strings."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        
        assert isinstance(settings.api_title, str)
        assert isinstance(settings.log_level, str)

    def test_list_fields_are_list(self) -> None:
        """List settings are actual lists."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        assert isinstance(settings.api_keys, list)


# ============================================================================
# Settings Validation Tests
# ============================================================================

class TestSettingsValidation:
    """Test Settings validation."""

    def test_settings_validates_on_creation(self) -> None:
        """Settings validates fields on creation."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        assert settings is not None

    def test_api_keys_field_exists(self) -> None:
        """api_keys field exists and is a list."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        
        assert hasattr(settings, "api_keys")
        assert isinstance(settings.api_keys, list)

    def test_positive_rate_limit_values(self) -> None:
        """Rate limit values are positive."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        
        assert settings.rate_limit_requests > 0
        assert settings.rate_limit_window_seconds > 0


# ============================================================================
# Field Validator Tests
# ============================================================================

class TestFieldValidators:
    """Test field validators in Settings."""

    def test_api_keys_validator_handles_empty(self) -> None:
        """api_keys validator handles empty string."""
        from app.config.settings import Settings
        
        # Call validator directly
        result = Settings._split_api_keys("")
        assert result == []
        
        result = Settings._split_api_keys(None)
        assert result == []

    def test_api_keys_validator_handles_comma_separated(self) -> None:
        """api_keys validator parses comma-separated string."""
        from app.config.settings import Settings
        
        result = Settings._split_api_keys("key1,key2,key3")
        assert result == ["key1", "key2", "key3"]

    def test_api_keys_validator_handles_list(self) -> None:
        """api_keys validator handles list input."""
        from app.config.settings import Settings
        
        result = Settings._split_api_keys(["key1", "key2"])
        assert result == ["key1", "key2"]

    def test_api_keys_validator_strips_whitespace(self) -> None:
        """api_keys validator strips whitespace."""
        from app.config.settings import Settings
        
        result = Settings._split_api_keys(" key1 , key2 , key3 ")
        assert result == ["key1", "key2", "key3"]

    def test_empty_string_to_none_validator(self) -> None:
        """Empty string to None validator works."""
        from app.config.settings import Settings
        
        result = Settings._convert_empty_string_to_none("")
        assert result is None
        
        result = Settings._convert_empty_string_to_none("value")
        assert result == "value"


# ============================================================================
# Settings String Representation Tests
# ============================================================================

class TestSettingsRepr:
    """Test Settings string representation."""

    def test_str_representation(self) -> None:
        """Settings has string representation."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        
        str_repr = str(settings)
        assert len(str_repr) > 0

    def test_repr_representation(self) -> None:
        """Settings has repr representation."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        
        repr_str = repr(settings)
        assert "Settings" in repr_str


# ============================================================================
# Specific Settings Tests
# ============================================================================

class TestSpecificSettings:
    """Test specific settings fields."""

    def test_llm_settings(self) -> None:
        """LLM settings have expected fields."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        
        assert hasattr(settings, "llm_repo_id")
        assert hasattr(settings, "llm_model_filename")
        assert hasattr(settings, "llm_gpu_layers")
        assert hasattr(settings, "llm_batch_size")
        assert hasattr(settings, "llm_n_threads")

    def test_whisper_settings(self) -> None:
        """Whisper settings have expected fields."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        
        assert hasattr(settings, "enable_faster_whisper")
        assert hasattr(settings, "faster_whisper_model_size")

    def test_openaudio_settings(self) -> None:
        """OpenAudio settings have expected fields."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        
        assert hasattr(settings, "openaudio_api_base")
        assert hasattr(settings, "openaudio_max_retries")

    def test_openai_settings(self) -> None:
        """OpenAI settings have expected fields."""
        from app.config.settings import get_settings
        
        settings = get_settings()
        
        assert hasattr(settings, "openai_api_key")
        assert hasattr(settings, "openai_whisper_model")
