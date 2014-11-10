angular.module('gsApp.workspaces.data', [
  'gsApp.workspaces.data.delete',
  'gsApp.workspaces.data.update',
  'gsApp.workspaces.data.import',
  'gsApp.workspaces.formats.type',
  'gsApp.workspaces.data.attributes',
  'gsApp.workspaces.layers.import',
  'gsApp.core.utilities',
  'gsApp.alertpanel',
  'ngSanitize'
])
.config(['$stateProvider',
    function($stateProvider) {
      $stateProvider.state('workspace.data', {
        url: '/data',
        templateUrl: '/workspaces/detail/data.tpl.html',
        controller: 'WorkspaceDataCtrl',
        abstract: true
      });
      $stateProvider.state('workspace.data.main', {
        url: '/',
        views: {
          'data': {
            templateUrl: '/workspaces/detail/data/data.main.tpl.html',
            controller: 'DataMainCtrl',
          }
        }
      });
      $stateProvider.state('workspace.data.import', {
        url: '',
        templateUrl: '/workspaces/detail/data/import/import.tpl.html',
        controller: 'DataImportCtrl',
        params: { workspace: {} }
      });
    }])
.controller('WorkspaceDataCtrl', ['$scope', '$rootScope', '$state',
  '$stateParams', '$modal', '$window', '$log', 'GeoServer', '_',
  'AppEvent', '$timeout', 'storesListModel',
    function($scope, $rootScope, $state, $stateParams, $modal, $log,
      $window, GeoServer, _, AppEvent, $timeout, storesListModel) {

      var workspace;
      if ($scope.workspace) {
        workspace = $scope.workspace;
      } else if ($stateParams.workspace) {
        workspace = $stateParams.workspace;
      }

      // Set stores list to window height
      $scope.storesListHeight = {'height': $window.innerHeight-250};

      $timeout(function() {
        if ($scope.$parent && $scope.$parent.tabs) {
          $scope.$parent.tabs[2].active = true;
        }
      }, 300);

      $scope.getDataStores = function(workspace) {
        storesListModel.fetchStores($scope.workspace).then(
          function() {
            $scope.datastores = storesListModel.getStores();
            if ($scope.datastores && $scope.datastores.length > 0) {
              $scope.selectStore($scope.datastores[0]);
            }
          });
      };
      $scope.getDataStores($scope.workspace);

      $scope.storesHome = function() {
        if (!$state.is('workspace.data.main')) {
          $state.go('workspace.data.main', {workspace:$scope.workspace});
        }
      };

      $scope.selectStore = function(store) {
        if ($scope.selectedStore &&
              $scope.selectedStore.name===store.name) {
          return;
        }
        $scope.selectedStore = store;

        GeoServer.datastores.getDetails($scope.workspace, store.name).then(
        function(result) {
          if (result.success) {
            var storeData = result.data;
            $scope.selectedStore = storeData;
          } else {
            $rootScope.alerts = [{
              type: 'warning',
              message: 'Details for store ' + $scope.selectedStore.name +
                ' could not be loaded.',
              fadeout: true
            }];
          }
        });
      };

      // for some reason modal below's being called twice without this lock
      $rootScope.importInitiated = false;

      $scope.importNewData = function(mapInfo) {
        var workspace;
        if ($scope.workspace) {
          workspace = $scope.workspace; // new map not yet created
        } else if (mapInfo.workspace) {
          workspace = mapInfo.workspace; // from an existing map
        }

        if (!$scope.importInitiated) {
          $rootScope.importInitiated = true;
          $scope.mapInfo = mapInfo;
          var importModalInstance = $modal.open({
            templateUrl: '/workspaces/detail/data/import/import.tpl.html',
            controller: 'DataImportCtrl',
            backdrop: 'static',
            size: 'lg',
            resolve: {
              workspace: function() {
                return workspace;
              },
              mapInfo: function() {
                return $scope.mapInfo;
              }
            }
          }).result.then(function(param) {
            $rootScope.importInitiated = false;
          });
        }
      };

      $rootScope.$on(AppEvent.ImportData, function(scope, mapInfo) {
        $scope.importNewData(mapInfo);
      });

      $rootScope.$on(AppEvent.StoreAdded, function(scope, workspace) {
        $scope.getDataStores(workspace);
      });

      $scope.addNewStore = function() {
        $state.go('workspace.data.import.file', {
          workspace: $scope.workspace
        });
      };

      $scope.storeRemoved = function(storeToRemove) {
        var index = _.findIndex($scope.datastores, function(ds) {
          return ds.name===storeToRemove.name;
        });
        if (index > -1) {
          $scope.datastores.splice(index, 1);
        }
        $scope.selectedStore = null;
      };

      $scope.deleteStore = function() {
        if (!$state.is('workspace.data.main')) {
          $state.go('workspace.data.main', {workspace:$scope.workspace});
        }
        var modalInstance = $modal.open({
          templateUrl: '/workspaces/detail/modals/data.delete.tpl.html',
          controller: 'WorkspaceDeleteDataCtrl',
          backdrop: 'static',
          size: 'md',
          resolve: {
            workspace: function() {
              return $scope.workspace;
            },
            store: function() {
              return $scope.selectedStore;
            },
            storeRemoved: function() {
              return $scope.storeRemoved;
            }
          }
        });
      };
    }])
.controller('DataMainCtrl', ['$scope', '$rootScope', '$state',
  '$stateParams', '$modal', '$window', '$log', 'GeoServer',
    function($scope, $rootScope, $state, $stateParams, $modal, $log,
      $window, GeoServer) {

      // See utilities.js pop directive - 1 popover open at a time
      var openPopoverStore;
      $scope.closePopovers = function(store) {
        if (openPopoverStore || openPopoverStore===store) {
          openPopoverStore.showSourcePopover = false;
          openPopoverStore = null;
        } else {
          store.showSourcePopover = true;
          openPopoverStore = store;
        }
      };
      var openPopoverPublished;
      $scope.closeResourcePopovers = function(resource) {
        if (openPopoverPublished || openPopoverPublished===resource) {
          openPopoverPublished.publishedPopover = false;
          openPopoverPublished = null;
        } else {
          resource.publishedPopover = true;
          openPopoverPublished = resource;
        }
      };

      $scope.getLayersForResource = function(resource) {
        var layers = resource.layers;
        var returnString = '';
        for (var t=0; t < layers.length; t++) {
          returnString += layers[t].name + ' ';
        }
        return returnString;
      };

      $scope.showLayer = function(layer) {
        $state.go('workspace.layers', { 'layer': layer });
      };

      $scope.showAttrs = function(layerOrResource, attributes) {
        var modalInstance = $modal.open({
          templateUrl: '/workspaces/detail/modals/data.attributes.tpl.html',
          controller: 'WorkspaceAttributesCtrl',
          size: 'md',
          resolve: {
            layerOrResource: function() {
              return layerOrResource;
            },
            attributes: function() {
              return attributes;
            }
          }
        });
      };

      $scope.enableDisableStore = function(store) {
        var modalInstance = $modal.open({
          templateUrl: '/workspaces/detail/modals/data.update.tpl.html',
          controller: 'UpdateStoreCtrl',
          size: 'md',
          resolve: {
            store: function() {
              return store;
            },
            workspace: function() {
              return $scope.workspace;
            }
          }
        });
      };

      $scope.importAsNewLayer = function(resource, store) {
        var modalInstance = $modal.open({
          templateUrl: '/workspaces/detail/modals/layer.import.tpl.html',
          controller: 'ImportLayerCtrl',
          size: 'md',
          resolve: {
            resource: function() {
              return resource;
            },
            workspace: function() {
              return $scope.workspace;
            },
            store: function() {
              return store;
            }
          }
        });
      };

      // Get Formats Info
      $scope.formats = {
        'vector': [],
        'raster': [],
        'service': []
      };
      GeoServer.formats.get().then(
        function(result) {
          if (result.success) {
            var formats = result.data;
            for (var i=0; i < formats.length; i++) {
              $scope.formats[formats[i].kind.toLowerCase()].push(formats[i]);
            }
          }
        });
      $scope.getTypeDetails = function(resource) {
        var modalInstance = $modal.open({
          templateUrl: '/workspaces/detail/modals/format.type.tpl.html',
          controller: 'FormatTypeInfoCtrl',
          backdrop: 'static',
          size: 'md',
          resolve: {
            formats: function() {
              return $scope.formats;
            },
            resource: function() {
              return resource;
            }
          }
        });
      };
    }])
.service('storesListModel', function(GeoServer, _, $rootScope) {
  var _this = this;
  this.stores = null;

  this.getStores = function() {
    return _this.stores;
  };

  this.setStores = function(stores) {
    _this.stores = stores;
  };

  this.addStore = function(store) {
    _this.stores.push(store);
  };

  this.removeStore = function(store) {
    _.remove(_this.stores, function(_store) {
      return _store.name === store.name;
    });
  };

  this.tagStores = function(stores) {
    for (var i=0; i < stores.length; i++) {
      var ds = stores[i];
      var format = ds.format.toLowerCase();
      if (format === 'shapefile') {
        ds.sourcetype = 'shp';
      } else if (ds.kind.toLowerCase() === 'raster') {
        ds.sourcetype = 'raster';
      } else if (ds.type.toLowerCase() === 'database') {
        ds.sourcetype = 'database';
      } else if (format.indexOf('directory of spatial files')!==-1) {
        ds.sourcetype = 'shp_dir';
      }
    }
    return stores;
  };

  this.fetchStores = function(workspace) {
    return GeoServer.datastores.get(workspace).then(
      function(result) {
        if (result.success) {
          var stores = result.data;
          // tag for display
          _this.setStores(_this.tagStores(stores));
        } else {
          $rootScope.alerts = [{
            type: 'warning',
            message: 'Unable to load workspace data stores.',
            fadeout: true
          }];
        }
      });
  };
});
