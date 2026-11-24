# Changelog

## Unreleased

- Closing the session no longer leaves "already disposed" errors in the GNOME
  Shell log: the extension stops as soon as its Band entry is destroyed.

## 0.1

- A neutral pill per network in the Wi-Fi menu: the bands it is on, the band in
  use highlighted.
- A Band entry for the network in use: its access points with channel, signal
  and a health dot, Auto / 5 GHz / 2.4 GHz, and a switch to stay on one access
  point.
- Takes a change back after 25 seconds if the router refuses the connection, and
  remembers which access point refused.
