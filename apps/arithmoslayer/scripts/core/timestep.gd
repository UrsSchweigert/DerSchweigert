class_name Timestep
extends RefCounted
## Fixed simulation timestep shared by every deterministic system.
##
## Simulation advances in whole [constant FIXED_DELTA] ticks so that replaying
## a seed at the same tick count always produces the same result, regardless of
## the frame rate the game happens to run at.

const FIXED_DELTA: float = 1.0 / 60.0
