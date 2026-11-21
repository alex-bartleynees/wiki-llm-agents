# Vault registration and settings contracts

Keep an explicit empty request schema for listing vaults. It preserves the
Request → Endpoint → Response layout and gives future filters a defined place.

Registration takes an absolute folder path after home expansion and identifies
the vault by its canonical path. It defaults the display name to the folder
name. Return 201 for a new registration and 200 with the existing vault for a
repeat registration. This makes repeating the startup `--vault` flag safe.

Store the template folder relative to its vault. Accept null or an empty string
to turn templates off and return null for an unset template folder.
