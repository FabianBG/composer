/*global window, document, ZeroClipboard, $ */
angular.module('gsApp.styleditor.icons', [
  'angularFileUpload',
  'gsApp.core.utilities'
])
.directive('styleEditorIcons', ['$modal', '$log', 'GeoServer',
    function($modal, $log, GeoServer) {
      return {
        restrict: 'EA',
        scope: {
          editor: '='
        },
        template:
          '<li ' +
            'ng-click="selectIcon();">'+
            '<i class="icon-flag"></i>'+
            '<span>Icons</span>'+
          '</li>',
        replace: true,
        controller: function($scope, $element, $modal) {

          $scope.icons = [];
          var workspace = $scope.$parent.workspace;

          GeoServer.icons.get(workspace)
            .then(function(result) {
              if (result.success) {
                $scope.icons = result.data;
              } else {
                $scope.$parent.alerts = [{
                  type: 'warning',
                  message: 'Cannot load icons.',
                  fadeout: true
                }];
              }
            });

          $scope.selectIcon = function() {
            if ($scope.icons.length===-1) {
              $scope.$parent.alerts = [{
                type: 'warning',
                message: 'Cannot load icons.',
                fadeout: true
              }];
              return;
            }
            $modal.open({
              templateUrl: '/components/styleditor/tools/icons.modal.tpl.html',
              controller: 'IconsModalCtrl',
              size: 'lg',
              resolve: {
                workspace: function() {
                  return workspace;
                },
                icons: function() {
                  return $scope.icons;
                }
              }
            });
          };
        }
      };
    }])
.controller('IconsModalCtrl', ['$scope', '$modalInstance', '$upload', '$log',
    'GeoServer', 'workspace', 'icons', '$timeout',
    function($scope, $modalInstance, $upload, $log, GeoServer, workspace,
      icons, $timeout) {

      $scope.workspace = workspace;
      $scope.icons = icons;

      $scope.close = function () {
        $modalInstance.dismiss('cancel');
      };

      $scope.chooseIcon = function(iconname) {
        $scope.selectedIconName = iconname;
      };

      $scope.uploadIcons = function(files) {
        $scope.uploadRunning = true;
        $upload.upload({
          url: GeoServer.icons.url($scope.workspace),
          method: 'POST',
          file: files[0]
        }).success(function(result) {
          result.forEach(function(icon) {
            icons.push(icon);
          });
          $scope.uploadRunning = false;
        });
      };

      $timeout(function() {
        new ZeroClipboard($('#copyIcon')).on('copy',
          function(event) {
            var clipboard = event.clipboardData;
            if ($scope.selectedIconName) {
              clipboard.setData('text/plain',
                $scope.selectedIconName
              );
              $scope.close();
            }
        });
      }, 500);

    }]);
