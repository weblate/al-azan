import MapLibreGL, {ShapeSourceProps} from '@maplibre/maplibre-react-native';
import {Coordinates, Qibla} from 'adhan';
import debounce from 'lodash/debounce';
import {Button, Text} from 'native-base';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Linking, StyleSheet, View} from 'react-native';
import {CheckIcon} from '@/assets/icons/material_icons/check';
import {CloseIcon} from '@/assets/icons/material_icons/close';
import {ExploreIcon} from '@/assets/icons/material_icons/explore';
import Compass, {setUpdateRate} from '@/modules/compass';
import {calcSettings} from '@/store/calculation';

// Will be null for most users (only Mapbox authenticates this way).
// Required on Android. See Android installation notes.
MapLibreGL.setAccessToken(null);

const styles = StyleSheet.create({
  page: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5FCFF',
  },
  map: {
    flex: 1,
    alignSelf: 'stretch',
  },
});

const mapStyle = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap Contributors',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm', // This must match the source key above
    },
  ],
};

function getLineGeoJson(from: number[], to: number[]) {
  const geojson: ShapeSourceProps['shape'] = {
    type: 'LineString',
    coordinates: [from, to],
  };
  return geojson;
}

function getDirectionSecondPoint({
  lat,
  long,
  degree,
  distance = 10,
}: {
  lat: number;
  long: number;
  degree: number;
  /** in kilometers */
  distance?: number;
}) {
  // assumes degree is between 0-360 degrees from north clockwise
  const bearing = (degree * Math.PI) / 180;
  const R = 6371; // radius of Earth in KM

  const latRad = (lat * Math.PI) / 180;
  const longRad = (long * Math.PI) / 180;

  const latitude2 = Math.asin(
    Math.sin(latRad) * Math.cos(distance / R) +
      Math.cos(latRad) * Math.sin(distance / R) * Math.cos(bearing),
  );
  const longitude2 =
    longRad +
    Math.atan2(
      Math.sin(bearing) * Math.sin(distance / R) * Math.cos(latRad),
      Math.cos(distance / R) - Math.sin(latRad) * Math.sin(latitude2),
    );

  return {
    lat: (latitude2 * 180) / Math.PI,
    long: (longitude2 * 180) / Math.PI,
  };
}

export function QiblaMap() {
  const compassDegree = useRef(0);
  const qiblaDegree = useRef(0);
  const cameraRef = useRef<MapLibreGL.Camera>();
  const coords = useRef<number[]>([0, 0]);
  const [qiblaDirCoords, setQiblaDirCoords] = useState<number[]>([0, 0]);
  const [userDirCoords, setUserDirCoords] = useState<number[]>([0, 0]);
  const wasFacingKaaba = useRef(false);
  const [isFacingKaaba, setIsFacingKaaba] = useState(false);
  const [compassLock, setCompassLock] = useState(false);
  const compassLockRef = useRef(false);
  const gotLocationOnce = useRef(false);

  const updateCamera = useCallback(() => {
    const qiblaSecondPoint = getDirectionSecondPoint({
      lat: coords.current[1],
      long: coords.current[0],
      degree: qiblaDegree.current,
    });

    const userSecondPoint = getDirectionSecondPoint({
      lat: coords.current[1],
      long: coords.current[0],
      degree: compassDegree.current,
    });

    setQiblaDirCoords([qiblaSecondPoint.long, qiblaSecondPoint.lat]);
    setUserDirCoords([userSecondPoint.long, userSecondPoint.lat]);

    let facingKaaba = false;
    if (Math.abs(compassDegree.current - qiblaDegree.current) < 1) {
      facingKaaba = true;
    }
    if (wasFacingKaaba.current !== facingKaaba) {
      wasFacingKaaba.current = facingKaaba;
      setIsFacingKaaba(facingKaaba);
    }

    if (compassLockRef.current) {
      cameraRef.current?.setCamera({
        heading: compassDegree.current,
        centerCoordinate: coords.current,
      });
    } else {
      cameraRef.current?.setCamera({
        centerCoordinate: coords.current,
      });
    }
  }, []);

  useEffect(() => {
    setUpdateRate(__DEV__ ? 500 : 60);
    if (compassLock) {
      const sub = Compass.addListener('heading', h => {
        compassDegree.current = h;
        updateCamera();
      });
      return () => sub.remove();
    }
    return () => {};
  }, [updateCamera, compassLock]);

  const onUserLocationUpdate = useCallback(
    (location: MapLibreGL.Location) => {
      coords.current = [location.coords.longitude, location.coords.latitude];
      qiblaDegree.current = Qibla(
        new Coordinates(location.coords.latitude, location.coords.longitude),
      );
      updateCamera();
    },
    [updateCamera],
  );

  useEffect(() => {
    if (gotLocationOnce.current) return;
    const {LOCATION_LAT, LOCATION_LONG} = calcSettings.getState();
    if (LOCATION_LAT && LOCATION_LONG) {
      gotLocationOnce.current = true;
      onUserLocationUpdate({
        coords: {latitude: LOCATION_LAT, longitude: LOCATION_LONG},
      });
    }
  }, [onUserLocationUpdate]);

  const onOpenStreetMapPress = useCallback(async () => {
    if (await Linking.canOpenURL('https://www.openstreetmap.org/copyright')) {
      Linking.openURL('https://www.openstreetmap.org/copyright');
    }
  }, []);

  const toggleCompassLock = useCallback(() => {
    compassLockRef.current = !compassLockRef.current;
    setCompassLock(compassLockRef.current);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedCameraUpdate = useCallback(
    debounce(() => {
      updateCamera();
    }, 150),
    [],
  );

  return (
    <View style={styles.page}>
      <View
        style={{
          backgroundColor: '#00000099',
          position: 'absolute',
          right: 0,
          bottom: 0,
          zIndex: 1,
          flexDirection: 'row',
        }}>
        <Text
          padding="1"
          color="white"
          fontSize="xs"
          onPress={onOpenStreetMapPress}>
          &copy; OpenStreetMap Contributors
        </Text>
      </View>
      <Button
        position="absolute"
        right="1"
        bottom="8"
        zIndex={1}
        backgroundColor="black:alpha.50"
        h="10"
        w="10"
        borderColor={compassLock ? 'primary.400' : 'black:alpha.50'}
        borderWidth={1}
        onPress={toggleCompassLock}>
        <ExploreIcon color={compassLock ? 'primary.400' : 'white'} size="2xl" />
      </Button>
      {compassLock ? (
        <View
          style={{
            backgroundColor: '#00000099',
            position: 'absolute',
            left: 3,
            top: 3,
            zIndex: 1,
            flexDirection: 'row',
          }}>
          {isFacingKaaba ? (
            <CheckIcon size="5xl" color="#59cf78" />
          ) : (
            <CloseIcon size="5xl" />
          )}
        </View>
      ) : undefined}
      <MapLibreGL.MapView
        style={styles.map}
        attributionEnabled={true}
        attributionPosition={{left: 5, bottom: 5}}
        logoEnabled={false}
        zoomEnabled={true}
        pitchEnabled={false}
        scrollEnabled={false}
        rotateEnabled={true}
        compassEnabled={true}
        localizeLabels={true}
        compassViewPosition={1}
        onTouchEnd={debouncedCameraUpdate}>
        {/* @ts-ignore */}
        <MapLibreGL.Style json={mapStyle} />
        <MapLibreGL.Camera
          // @ts-ignore
          ref={cameraRef}
          zoomLevel={10}
          minZoomLevel={12}
        />
        <MapLibreGL.UserLocation
          visible={true}
          showsUserHeadingIndicator={false}
          renderMode="normal"
          onUpdate={onUserLocationUpdate}
        />
        <MapLibreGL.ShapeSource
          id="qibla_line"
          shape={getLineGeoJson(coords.current, qiblaDirCoords)}
        />
        <MapLibreGL.ShapeSource
          id="user_line"
          shape={getLineGeoJson(coords.current, userDirCoords)}
        />
        <MapLibreGL.LineLayer
          id="qibla_line_highlight"
          sourceID="qibla_line"
          style={{
            lineCap: 'round',
            lineJoin: 'round',
            lineColor: '#444',
            lineWidth: 10,
          }}
        />
        <MapLibreGL.LineLayer
          id="qibla_line_layer"
          sourceID="qibla_line"
          style={{
            lineCap: 'round',
            lineJoin: 'round',
            lineColor: '#ffdd00',
            lineWidth: 3,
          }}
        />
        {compassLock ? (
          <MapLibreGL.LineLayer
            id="user_line_layer"
            sourceID="user_line"
            style={{
              lineCap: 'round',
              lineJoin: 'round',
              lineColor: isFacingKaaba ? '#59cf78' : '#000',
              lineWidth: 3,
            }}
          />
        ) : undefined}
      </MapLibreGL.MapView>
    </View>
  );
}
