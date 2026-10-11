#!/bin/sh
# regenere passwd (a lancer depuis mosquitto/, docker requis)

NODES="N-ROOM-DES N-ROOM-TRO N-ROOM-QUA N-ROOM-SOI
N-DES-01 N-DES-02 N-DES-03 N-DES-04 N-DES-05 N-DES-06
N-TRO-01 N-TRO-02 N-TRO-03 N-TRO-04 N-TRO-05 N-TRO-06
N-QUA-01 N-QUA-02 N-QUA-03 N-QUA-04
N-SOI-01 N-SOI-02 N-SOI-03
N-EXT-01 N-EXT-02
N-DOOR-MAIN N-DOOR-SAS N-DOOR-FEED"

rm -f passwd && touch passwd
CMDS="mosquitto_passwd -b /work/passwd front frontpass && mosquitto_passwd -b /work/passwd admin adminpass"
for n in $NODES; do
  CMDS="$CMDS && mosquitto_passwd -b /work/passwd $n nodepass"
done

MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd):/work" eclipse-mosquitto:2 sh -c "$CMDS"
echo "passwd genere ($(wc -l < passwd) comptes)"
