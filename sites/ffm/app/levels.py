"""Canonical curriculum; this file and its data are never deployed to S3."""

import json
from copy import deepcopy
from pathlib import Path

with Path(__file__).with_name('level_data.json').open(encoding='utf-8') as source:
    _LEVELS = json.load(source)['levels']
if len(_LEVELS) != 60 or any(cfg['level'] != index + 1 for index, cfg in enumerate(_LEVELS)):
    raise ValueError('Invalid canonical curriculum')


def get_level_config(level_num):
    if type(level_num) is not int or not 1 <= level_num <= len(_LEVELS):
        return None
    return deepcopy(_LEVELS[level_num - 1])


def total_levels():
    return len(_LEVELS)
