angular.module('gsApp.maps', [
  'ngGrid',
  'ui.select',
  'ngSanitize',
  'gsApp.alertpanel',
  'gsApp.projfield',
  'gsApp.core.utilities',
  'gsApp.maps.compose',
  'angularMoment'
])
.config(['$stateProvider',
    function($stateProvider) {
      $stateProvider
        .state('maps', {
          url: '/maps',
          templateUrl: '/maps/maps.tpl.html',
          controller: 'MapsCtrl'
        })
        .state('map', {
          abstract: true,
          url: '/maps/:workspace/:name',
          templateUrl: '/maps/detail/map.tpl.html'
        });
    }])
.controller('MapsCtrl', ['$scope', 'GeoServer', '$state', '$log', '$rootScope',
    '$modal', '$window', '$stateParams', 'AppEvent', '$timeout', '$sce', '_',
    function($scope, GeoServer, $state, $log, $rootScope, $modal, $window,
      $stateParams, AppEvent, $timeout, $sce, _) {

      $scope.title = 'All Maps';
      $scope.workspace = $stateParams.workspace;

      $scope.$watch('workspace.selected', function(newVal) {
        if (newVal != null) {
          var ws = newVal;
          $rootScope.$broadcast(AppEvent.WorkspaceSelected,
            ws.name);
          $scope.refreshMaps();
        }
      });

      $scope.newOLWindow = function(map) {
        var baseUrl = GeoServer.map.openlayers.get(
          map.workspace, map.name, 800, 500);
        $window.open(baseUrl);
      };

      $scope.go = function(route, workspace) {
        $state.go(route, {workspace: workspace});
      };

      $scope.createMap = function(workspace) {
        $timeout(function() {
          $rootScope.$broadcast(AppEvent.CreateNewMap);
        }, 250);
        // go to this state to initiate listener for broadcast above!
        $state.go('workspace.maps.main', {workspace: workspace});
      };

      $scope.importData = function(workspace) {
        $timeout(function() {
          $rootScope.$broadcast(AppEvent.ImportData);
        }, 250);
        // go to this state to initiate listener for broadcast above!
        $state.go('workspace.data.import', {workspace: workspace});
      };

      $scope.deleteMap = function(map, workspace) {
        var modalInstance = $modal.open({
          templateUrl: '/maps/deletemap-modal.tpl.html',
          controller: ['$scope', '$window', '$modalInstance', '$state',
            function($scope, $window, $modalInstance, $state) {
              $scope.workspace = workspace.name;
              $scope.map = map.name;

              $scope.ok = function() {
                GeoServer.map.remove($scope.workspace, $scope.map).then(
                  function(result) {
                    $modalInstance.dismiss('cancel');
                    if (result.success) {
                      $rootScope.alerts = [{
                        type: 'success',
                        message: 'Map "' + $scope.map + '"" has been deleted ' +
                          'from the workspace "' + $scope.workspace + '".',
                        fadeout: true
                      }];
                    } else {
                      $rootScope.alerts = [{
                        type: 'danger',
                        message: 'Map "' + $scope.map + '"" could not be ' +
                          'deleted from the workspace "' +
                          $scope.workspace + '".',
                        fadeout: true
                      }];
                    }
                    if ($scope.mapNameCheck.name) {$scope.mapNameError = true;}
                    else {$scope.mapNameError = false;}
                  });
              };

              $scope.cancel = function() {
                $modalInstance.dismiss('cancel');
              };
            }],
          backdrop: 'static',
          size: 'med'
        });
      };

      $scope.$watch('gridOptions.ngGrid.config.sortInfo', function() {
        $scope.refreshMaps();
      }, true);

      $scope.refreshMaps = function() {
        $scope.sort = '';
        $scope.ws = $scope.workspace.selected;
        if ($scope.gridOptions.sortInfo.directions == 'asc') {
          $scope.sort = $scope.gridOptions.sortInfo.fields+':asc';
        }
        else {
          $scope.sort = $scope.gridOptions.sortInfo.fields+':desc';
        }

        if ($scope.ws) {
          GeoServer.maps.get(
            $scope.ws.name,
            $scope.pagingOptions.currentPage-1,
            $scope.pagingOptions.pageSize,
            $scope.sort,
            $scope.filterOptions.filterText
          ).then(function(result) {
            if (result.success) {
              $scope.mapData = result.data.maps;
              $scope.totalServerItems = result.data.total;
              $scope.itemsPerPage = $scope.pagingOptions.pageSize;

              if ($scope.filterOptions.filterText.length > 0) {
                $scope.totalItems =
                  $scope.gridOptions.ngGrid.filteredRows.length;
              }
              else {
                $scope.totalItems = $scope.totalServerItems;
              }
            } else {
              $rootScope.alerts = [{
                type: 'warning',
                message: 'Maps for workspace ' + $scope.ws.name +
                  ' could not be loaded.',
                fadeout: true
              }];
            }
          });
        }
      };

      $scope.updatePaging = function () {
        $scope.refreshMaps();
      };

      $scope.setPage = function (page) {
        $scope.pagingOptions.currentPage = page;
      };

      $scope.$watch('pagingOptions', function (newVal, oldVal) {
        if (newVal != null) {
          if ($scope.workspace.selected) {
            $scope.refreshMaps();
          }
        }
      }, true);

      $scope.editMapSettings = function(map) {
        var modalInstance = $modal.open({
          templateUrl: '/workspaces/detail/modals/map.settings.tpl.html',
          controller: 'EditMapSettingsCtrl',
          backdrop: 'static',
          size: 'md',
          resolve: {
            workspace: function() {
              return $scope.workspace;
            },
            map: function() {
              return map;
            }
          }
        });
      };

      // See utilities.js pop directive - 1 popover open at a time
      var openPopoverDownload;
      $scope.closePopovers = function(popo) {
        if (openPopoverDownload || openPopoverDownload===popo) {
          openPopoverDownload.showSourcePopover = false;
          openPopoverDownload = null;
        } else {
          popo.showSourcePopover = true;
          openPopoverDownload = popo;
        }
      };

      $scope.linkDownloads = function(map) {
        var bbox = [map.bbox.west, map.bbox.south, map.bbox.east,
          map.bbox.north];
        bbox = bbox.join();

        var baseurl = GeoServer.baseUrl() + '/' + map.workspace +
          '/wms?service=WMS&amp;version=1.1.0&request=GetMap&layers=' +
          map.name + '&bbox=' + bbox + '&width=700&height=700' +
          '&srs=' + map.proj.srs + '&format=';

        var kml = baseurl + 'application/vnd.google-earth.kml%2Bxml';
        var ol2 = baseurl + 'application/openlayers';

        map.download_urls = '';
        map.download_urls += '<a target="_blank" href="' + ol2 +
          '">OpenLayers</a> <br />';
        map.download_urls += '<a target="_blank" href="' + kml +
          '">KML</a> <br />';

        map.urls_ready = true;
        map.download_urls = $sce.trustAsHtml(map.download_urls);
      };

      $scope.onCompose = function(map) {
        $state.go('map.compose', {
          workspace: map.workspace,
          name: map.name
        });
      };

      $scope.$on('ngGridEventEndCellEdit', function(evt){
        var target = evt.targetScope;
        var field = target.col.field;
        var map = target.row.entity;
        var patch = {};
        patch[field] = map[field];

        GeoServer.map.update(map.workspace, map.name, {title: patch[field]});
      });

      $scope.pagingOptions = {
        pageSizes: [15, 50, 100],
        pageSize: 15
      };
      $scope.filterOptions = {
        filterText: ''
      };

      $scope.gridSelections = [];
      $scope.gridOptions = {
        data: 'mapData',
        enableCellSelection: false,
        enableRowSelection: false,
        enableCellEdit: false,
        checkboxHeaderTemplate:
          '<input class="ngSelectionHeader" type="checkbox"' +
            'ng-model="allSelected" ng-change="toggleSelectAll(allSelected)"/>',
        sortInfo: {fields: ['name'], directions: ['asc']},
        showSelectionCheckbox: false,
        selectWithCheckboxOnly: false,
        selectedItems: $scope.gridSelections,
        multiSelect: false,
        columnDefs: [
          {field: 'name', displayName: 'Map Name', width: '15%'},
          {field: 'title',
            displayName: 'Title',
            enableCellEdit: true,
            cellTemplate:
              '<div class="grid-text-padding"' +
                'alt="{{row.entity.description}}"' +
                'title="{{row.entity.description}}">'+
                '{{row.entity.title}}' +
              '</div>',
            width: '20%'
          },
          {field: 'compose',
            displayName: 'Compose',
            cellClass: 'text-center',
            sortable: false,
            cellTemplate:
              '<div class="grid-text-padding" ng-class="col.colIndex()">' +
                '<a ng-click="onCompose(row.entity)">Compose</a>' +
              '</div>',
            width: '8%'
          },
          {field: 'preview',
            displayName: 'Preview',
            cellClass: 'text-center',
            sortable: false,
            cellTemplate:
              '<div ng-class="col.colIndex()">' +
                '<a ng-click="newOLWindow(row.entity)">' +
                  '<img ng-src="images/preview.png" alt="Preview Map"' +
                    'title="Preview Map" />' +
                '</a>' +
              '</div>',
            width: '6%'
          },
          {field: 'settings',
            displayName: 'Settings',
            sortable: false,
            cellClass: 'text-center',
            cellTemplate:
              '<div ng-class="col.colIndex()">' +
                '<a ng-click="editMapSettings(row.entity)">' +
                  '<img ng-src="images/settings.png"' +
                    'alt="Edit Map Settings" title="Edit Map Settings" />' +
                '</a>' +
              '</div>',
            width: '6%'
          },
          {field: 'download',
            displayName: 'Download',
            cellClass: 'text-center',
            sortable: false,
            cellTemplate:
              '<a popover-placement="bottom" popover-append-to-body="true"' +
              'popover-html-unsafe="{{ row.entity.download_urls }}" pop-show=' +
              '"{{ row.entity.showSourcePopover && row.entity.urls_ready }}"' +
                'ng-click="closePopovers(row.entity);' +
                  'linkDownloads(row.entity);">' +
                '<div class="fa fa-download grid-icons" ' +
                  'alt="Download Map" title="Download Map"></div></a>',
            width: '8%'
          },
          {field: 'modified.timestamp',
            displayName: 'Modified',
            cellTemplate:
              '<div class="grid-text-padding" style="font-size: .9em">' +
              '{{row.entity.modified.timestamp|amDateFormat:"MMM D, h:mm a"}}' +
              '</div>',
            width: '11%'},
          {field: '',
            displayName: '',
            cellClass: 'pull-left',
            sortable: false,
            cellTemplate:
              '<div ng-class="col.colIndex()">' +
                '<a ng-click="deleteMap(row.entity, workspace.selected)">' +
                  '<img ng-src="images/delete.png" alt="Remove Map"' +
                    'title="Remove Map" />' +
                '</a>' +
              '</div>',
            width: '*'
          }
        ],
        enablePaging: true,
        enableColumnResize: false,
        showFooter: true,
        footerTemplate: '/components/grid/footer.tpl.html',
        totalServerItems: 'totalServerItems',
        pagingOptions: $scope.pagingOptions,
        filterOptions: $scope.filterOptions
      };

      $scope.workspace = {};
      $scope.workspaces = [];

      $scope.updatePaging = function () {
        var ws = $scope.workspace.selected;
        $scope.refreshLayers(ws);
      };

      $scope.setPage = function (page) {
        $scope.pagingOptions.currentPage = page;
      };

      $scope.$watch('pagingOptions', function (newVal, oldVal) {
        if (newVal != null) {
          var ws = $scope.workspace.selected;
          if (ws != null) {
            $scope.refreshLayers(ws);
          }
        }
      }, true);

      GeoServer.workspaces.get().then(
        function(result) {
          if (result.success) {
            var workspaces = result.data;
            $scope.workspaces = workspaces;
            var ws = _.find(workspaces, function(workspace) {
              return workspace.default;
            });
            $scope.workspace.selected = ws;
          } else {
            $scope.alerts = [{
              type: 'warning',
              message: 'Workspace update failed.',
              fadeout: true
            }];
          }
        });

    }]);

