import os
from setuptools import setup, Extension
import pybind11

ext_modules = [
    Extension(
        'route_core',
        sources=['core/engine.cpp', 'core/binding.cpp'],
        include_dirs=[pybind11.get_include()],
        language='c++',
        extra_compile_args=['-std=c++17', '-O3', '-pthread']
    ),
]

setup(
    name='route_core',
    version='0.1.0',
    author='Antigravity',
    description='C++ Core engine for AI Route Planner',
    ext_modules=ext_modules,
)
