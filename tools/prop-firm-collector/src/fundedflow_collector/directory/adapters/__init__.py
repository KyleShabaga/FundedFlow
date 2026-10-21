"""Registered directory adapters. A publisher names one of these; an unknown name is a configuration error."""

from __future__ import annotations

from fundedflow_collector.directory.adapters.base import DirectoryAdapter
from fundedflow_collector.directory.adapters.generic import GenericAdapter
from fundedflow_collector.directory.adapters.onlypropfirms import OnlyPropFirmsAdapter
from fundedflow_collector.directory.adapters.propfirmgorilla import PropFirmGorillaAdapter
from fundedflow_collector.directory.adapters.propfirmmatch import PropFirmMatchFuturesAdapter
from fundedflow_collector.directory.adapters.traderssecondbrain import TradersSecondBrainAdapter

ADAPTERS: dict[str, DirectoryAdapter] = {
    adapter.name: adapter
    for adapter in (
        OnlyPropFirmsAdapter(),
        TradersSecondBrainAdapter(),
        PropFirmMatchFuturesAdapter(),
        PropFirmGorillaAdapter(),
        GenericAdapter(),
    )
}


class UnknownAdapter(ValueError):
    pass


def get_adapter(name: str) -> DirectoryAdapter:
    try:
        return ADAPTERS[name]
    except KeyError as exc:
        raise UnknownAdapter(f"unknown adapter {name!r}; known: {', '.join(sorted(ADAPTERS))}") from exc
