class_name SaveMigrations
extends RefCounted
## Ordered schema migrations for per-profile save data.
##
## Entry `i` in [member migrations] upgrades a profile from schema version `i`
## to `i + 1`, so a profile that predates versioning is treated as version 0.

const CURRENT_SCHEMA_VERSION: int = 1
const SCHEMA_VERSION_KEY: String = "schema_version"

## One migration per schema version below [constant CURRENT_SCHEMA_VERSION].
static var migrations: Array[Callable] = [_migrate_v0_to_v1]


## Returns true when a migration exists that upgrades from [param from].
static func has_migration(from: int) -> bool:
	return from >= 0 and from < migrations.size()


## Migrates [param data] from schema version [param from] up to the current
## version, returning a new dictionary. The input is copied, never mutated.
static func migrate(data: Dictionary, from: int) -> Dictionary:
	var migrated: Dictionary = data.duplicate(true)
	var version: int = from
	while version < CURRENT_SCHEMA_VERSION:
		if not has_migration(version):
			push_error("SaveMigrations: no migration for schema version %d" % version)
			break
		migrated = migrations[version].call(migrated)
		version += 1
	migrated[SCHEMA_VERSION_KEY] = CURRENT_SCHEMA_VERSION
	return migrated


## Versionless v0 profiles gain the schema_version stamp.
static func _migrate_v0_to_v1(data: Dictionary) -> Dictionary:
	var migrated: Dictionary = data.duplicate(true)
	migrated[SCHEMA_VERSION_KEY] = 1
	return migrated
