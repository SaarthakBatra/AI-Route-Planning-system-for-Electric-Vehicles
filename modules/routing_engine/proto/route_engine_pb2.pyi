from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Objective(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FASTEST: _ClassVar[Objective]
    SHORTEST: _ClassVar[Objective]
FASTEST: Objective
SHORTEST: Objective

class Coordinate(_message.Message):
    __slots__ = ("lat", "lng")
    LAT_FIELD_NUMBER: _ClassVar[int]
    LNG_FIELD_NUMBER: _ClassVar[int]
    lat: float
    lng: float
    def __init__(self, lat: _Optional[float] = ..., lng: _Optional[float] = ...) -> None: ...

class RouteRequest(_message.Message):
    __slots__ = ("start", "end", "mock_hour", "objective", "map_data")
    START_FIELD_NUMBER: _ClassVar[int]
    END_FIELD_NUMBER: _ClassVar[int]
    MOCK_HOUR_FIELD_NUMBER: _ClassVar[int]
    OBJECTIVE_FIELD_NUMBER: _ClassVar[int]
    MAP_DATA_FIELD_NUMBER: _ClassVar[int]
    start: Coordinate
    end: Coordinate
    mock_hour: int
    objective: Objective
    map_data: str
    def __init__(self, start: _Optional[_Union[Coordinate, _Mapping]] = ..., end: _Optional[_Union[Coordinate, _Mapping]] = ..., mock_hour: _Optional[int] = ..., objective: _Optional[_Union[Objective, str]] = ..., map_data: _Optional[str] = ...) -> None: ...

class AlgorithmResult(_message.Message):
    __slots__ = ("algorithm", "polyline", "distance", "duration", "nodes_expanded", "exec_time_ms", "path_cost")
    ALGORITHM_FIELD_NUMBER: _ClassVar[int]
    POLYLINE_FIELD_NUMBER: _ClassVar[int]
    DISTANCE_FIELD_NUMBER: _ClassVar[int]
    DURATION_FIELD_NUMBER: _ClassVar[int]
    NODES_EXPANDED_FIELD_NUMBER: _ClassVar[int]
    EXEC_TIME_MS_FIELD_NUMBER: _ClassVar[int]
    PATH_COST_FIELD_NUMBER: _ClassVar[int]
    algorithm: str
    polyline: _containers.RepeatedCompositeFieldContainer[Coordinate]
    distance: float
    duration: float
    nodes_expanded: int
    exec_time_ms: float
    path_cost: float
    def __init__(self, algorithm: _Optional[str] = ..., polyline: _Optional[_Iterable[_Union[Coordinate, _Mapping]]] = ..., distance: _Optional[float] = ..., duration: _Optional[float] = ..., nodes_expanded: _Optional[int] = ..., exec_time_ms: _Optional[float] = ..., path_cost: _Optional[float] = ...) -> None: ...

class RouteResponse(_message.Message):
    __slots__ = ("results",)
    RESULTS_FIELD_NUMBER: _ClassVar[int]
    results: _containers.RepeatedCompositeFieldContainer[AlgorithmResult]
    def __init__(self, results: _Optional[_Iterable[_Union[AlgorithmResult, _Mapping]]] = ...) -> None: ...
