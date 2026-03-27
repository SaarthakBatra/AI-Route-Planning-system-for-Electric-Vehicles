from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Coordinate(_message.Message):
    __slots__ = ("lat", "lng")
    LAT_FIELD_NUMBER: _ClassVar[int]
    LNG_FIELD_NUMBER: _ClassVar[int]
    lat: float
    lng: float
    def __init__(self, lat: _Optional[float] = ..., lng: _Optional[float] = ...) -> None: ...

class RouteRequest(_message.Message):
    __slots__ = ("start", "end")
    START_FIELD_NUMBER: _ClassVar[int]
    END_FIELD_NUMBER: _ClassVar[int]
    start: Coordinate
    end: Coordinate
    def __init__(self, start: _Optional[_Union[Coordinate, _Mapping]] = ..., end: _Optional[_Union[Coordinate, _Mapping]] = ...) -> None: ...

class RouteResponse(_message.Message):
    __slots__ = ("polyline", "distance", "duration")
    POLYLINE_FIELD_NUMBER: _ClassVar[int]
    DISTANCE_FIELD_NUMBER: _ClassVar[int]
    DURATION_FIELD_NUMBER: _ClassVar[int]
    polyline: _containers.RepeatedCompositeFieldContainer[Coordinate]
    distance: float
    duration: float
    def __init__(self, polyline: _Optional[_Iterable[_Union[Coordinate, _Mapping]]] = ..., distance: _Optional[float] = ..., duration: _Optional[float] = ...) -> None: ...
